import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadFiles, whoAmI } from "@huggingface/hub";
import { resolveHuggingFaceToken } from "./huggingface-auth.mjs";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const defaultHub = { uploadFiles, whoAmI };

function retryable(error) {
  const status = error?.statusCode ?? error?.status ?? error?.response?.status;
  return status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

/** Retry only temporary transport failures, with bounded exponential backoff. */
export async function withDeliveryRetry(operation, options = {}) {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { status: "delivered", attempt, value: await operation(attempt) };
    } catch (error) {
      if (!retryable(error)) throw error;
      if (attempt === attempts)
        return {
          status: "deferred",
          attempt,
          reason: `temporary-http-${error.statusCode ?? error.status ?? error.response.status}`,
        };
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw Error("delivery retry loop ended unexpectedly");
}

/** Build stable transport metadata without changing the producer execution identity. */
export async function officialTransportMetadata({ artifact, manifest, signerWorkflowSha }) {
  const bytes = await readFile(path.resolve(artifact));
  const official = JSON.parse(await readFile(path.resolve(manifest), "utf8"));
  const executionId = official.executionIdentity?.executionId;
  if (!SHA256.test(executionId ?? "")) throw Error("official manifest has invalid executionId");
  if (!/^[a-f0-9]{40}$/.test(signerWorkflowSha ?? "")) throw Error("invalid signer workflow SHA");
  return {
    schemaVersion: 1,
    executionId,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    producer: {
      repository: official.executionIdentity.repository,
      runId: official.executionIdentity.runId,
      producerAttempt: official.executionIdentity.producerAttempt,
      invocation: official.executionIdentity.invocation,
    },
    signerWorkflowSha,
  };
}

/** Upload the original signed bytes as a candidate. Retry never rebuilds the archive. */
export async function submitOfficialCandidate({
  artifact,
  attestation,
  manifest,
  signerWorkflowSha,
  repository,
  accessToken,
  statusFile,
  hub = defaultHub,
  retry = {},
}) {
  if (!REPOSITORY.test(repository ?? "")) throw Error("Dataset repository must be owner/name");
  const token = await resolveHuggingFaceToken({ accessToken });
  if (!token) throw Error("HF_TOKEN is required for official delivery");
  const metadata = await officialTransportMetadata({ artifact, manifest, signerWorkflowSha });
  const identity = await hub.whoAmI({ accessToken: token });
  const prefix = `candidates/official/${metadata.executionId}`;
  const transport = {
    ...metadata,
    submitter: identity.name,
  };
  const files = [
    { path: `${prefix}/official-result.tar.gz`, content: new Blob([await readFile(artifact)]) },
    { path: `${prefix}/attestation.jsonl`, content: new Blob([await readFile(attestation)]) },
    {
      path: `${prefix}/transport.json`,
      content: new Blob([`${JSON.stringify(transport, null, 2)}\n`]),
    },
  ];
  const outcome = await withDeliveryRetry(async () => {
    const result = await hub.uploadFiles({
      repo: { type: "dataset", name: repository },
      accessToken: token,
      files,
      isPullRequest: true,
      commitTitle: `Contribute official benchmark execution ${metadata.executionId}`,
    });
    if (!result.pullRequestUrl || !result.commit.oid)
      throw Error("Hugging Face did not return a candidate receipt");
    return { pullRequestUrl: result.pullRequestUrl, commitOid: result.commit.oid };
  }, retry);
  const status = {
    schemaVersion: 1,
    status: outcome.status,
    executionId: metadata.executionId,
    artifactSha256: metadata.artifactSha256,
    attempts: outcome.attempt,
    ...(outcome.status === "delivered" ? outcome.value : { reason: outcome.reason }),
  };
  if (statusFile) await writeFile(path.resolve(statusFile), `${JSON.stringify(status, null, 2)}\n`);
  return status;
}
