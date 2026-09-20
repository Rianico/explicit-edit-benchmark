import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  commit,
  downloadFile,
  listCommits,
  listFiles,
  uploadFiles,
  whoAmI,
} from "@huggingface/hub";
import { buildSubmission } from "./benchmark-submission.mjs";
import { ingestSubmission } from "./benchmark-ingestion.mjs";
import {
  buildDerivedDatasetFromAggregateState,
  buildPublicDataset,
} from "./build-public-dataset.mjs";
import { appendAggregateRun, verifyAggregateState } from "./aggregate-state.mjs";
import { resolveHuggingFaceToken } from "./huggingface-auth.mjs";

const TABLES = [
  "profiles.jsonl",
  "configurations.jsonl",
  "trials.jsonl",
  "rounds.jsonl",
  "tool-calls.jsonl",
];
const CANDIDATE_FILES = ["manifest.json", ...TABLES, "submission.json"];
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const defaultHub = { commit, downloadFile, listCommits, listFiles, uploadFiles, whoAmI };

function datasetRepository(repository) {
  if (!REPOSITORY.test(repository ?? ""))
    throw Error("Hugging Face dataset repository must be owner/name");
  return { type: "dataset", name: repository };
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]))
    throw Error(`${label}: fields must be exactly ${keys.join(", ")}`);
}

export async function headCommit(hub, repo, accessToken) {
  for await (const item of hub.listCommits({ repo, revision: "main", accessToken }))
    return item.oid;
  throw Error("Hugging Face dataset main has no commits");
}

async function directoryFiles(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await directoryFiles(root, absolute)));
    else if (entry.isFile())
      result.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        content: pathToFileURL(absolute),
      });
    else throw Error(`Dataset output contains unsupported entry: ${absolute}`);
  }
  return result;
}

export async function publishDirectory({
  hub,
  repo,
  accessToken,
  parentCommit,
  outputDirectory,
  title,
}) {
  const files = await directoryFiles(outputDirectory);
  const generatedPaths = new Set(files.map((file) => file.path));
  const operations = files.map((file) => ({ operation: "addOrUpdate", ...file }));
  for await (const file of hub.listFiles({
    repo,
    revision: parentCommit,
    accessToken,
    recursive: true,
  })) {
    if (
      (!file.type || file.type === "file") &&
      file.path !== ".gitattributes" &&
      !generatedPaths.has(file.path) &&
      !file.path.startsWith("candidates/")
    )
      operations.push({ operation: "delete", path: file.path });
  }
  const result = await hub.commit({
    repo,
    accessToken,
    branch: "main",
    parentCommit,
    title,
    operations,
  });
  if (!result?.commit?.oid) throw Error("Hugging Face did not return a dataset commit");
  return result.commit.oid;
}

async function validateCandidateMetadata(metadata) {
  exactKeys(
    metadata,
    ["schemaVersion", "ownerId", "clientRunId", "purpose", "definitions"],
    "candidate metadata",
  );
  if (metadata.schemaVersion !== 1) throw Error("candidate metadata: schemaVersion must be 1");
  if (typeof metadata.ownerId !== "string" || !SAFE_SEGMENT.test(metadata.ownerId))
    throw Error("candidate metadata: invalid ownerId");
  return metadata;
}

async function ingestCandidate(storeDirectory, candidateDirectory) {
  const metadata = await validateCandidateMetadata(
    JSON.parse(await readFile(path.join(candidateDirectory, "submission.json"), "utf8")),
  );
  const submission = await buildSubmission(candidateDirectory, metadata);
  const result = await ingestSubmission(storeDirectory, { ownerId: metadata.ownerId }, submission);
  if (!result.created) throw Error("Candidate observation already exists on main");
  return { result, runId: submission.bundle.manifest.runId };
}

/** Upload a validated normalized bundle and safe metadata to a Hugging Face dataset pull request. */
export async function submitHuggingFaceCandidate({
  bundleDirectory,
  metadataFile,
  repository,
  accessToken,
  hub = defaultHub,
  homeDirectory,
  env,
}) {
  const repo = datasetRepository(repository);
  const token = await resolveHuggingFaceToken({ accessToken, homeDirectory, env });
  if (!token)
    throw Error("Hugging Face authentication is required; run `hf auth login` or set HF_TOKEN");
  const metadata = JSON.parse(await readFile(path.resolve(metadataFile), "utf8"));
  exactKeys(metadata, ["clientRunId", "purpose", "definitions"], "submission metadata");
  const submission = await buildSubmission(bundleDirectory, metadata);
  const runId = submission.bundle.manifest.runId;
  if (!SAFE_SEGMENT.test(runId)) throw Error(`Invalid runId: ${runId}`);
  const identity = await hub.whoAmI({ accessToken: token });
  const candidateMetadata = await validateCandidateMetadata({
    schemaVersion: 1,
    ownerId: identity.name,
    clientRunId: submission.clientRunId,
    purpose: submission.purpose,
    definitions: submission.definitions,
  });

  // Ingestion writes atomically, so validate in an isolated temporary store.
  const temporaryStore = await mkdtemp(path.join(os.tmpdir(), "hf-candidate-store-"));
  try {
    await ingestSubmission(temporaryStore, { ownerId: candidateMetadata.ownerId }, submission);
  } finally {
    await rm(temporaryStore, { recursive: true, force: true });
  }

  const prefix = `candidates/${runId}`;
  const files = await Promise.all([
    ...["manifest.json", ...TABLES].map(async (name) => ({
      path: `${prefix}/${name}`,
      content: new Blob([await readFile(path.join(bundleDirectory, name))]),
    })),
    Promise.resolve({
      path: `${prefix}/submission.json`,
      content: new Blob([`${JSON.stringify(candidateMetadata, null, 2)}\n`]),
    }),
  ]);
  const parentCommit = await headCommit(hub, repo, token);
  const result = await hub.uploadFiles({
    repo,
    accessToken: token,
    files,
    isPullRequest: true,
    parentCommit,
    commitTitle: `Contribute benchmark observation ${runId}`,
  });
  if (!result?.pullRequestUrl) throw Error("Hugging Face did not return a pull request URL");
  return { runId, pullRequestUrl: result.pullRequestUrl, commitOid: result.commit.oid };
}

function parseJsonLines(content) {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function downloadJson(hub, repo, revision, accessToken, filePath) {
  const blob = await hub.downloadFile({ repo, revision, accessToken, path: filePath });
  if (!blob) throw Error(`Dataset is missing ${filePath}`);
  return JSON.parse(await blob.text());
}

/** Download only the immutable files belonging to one ordinary Dataset candidate. */
export async function downloadHuggingFaceCandidate({
  hub,
  repo,
  repository,
  candidateNumber,
  accessToken,
  directory,
  fetchImpl = fetch,
}) {
  if (!/^\d+$/.test(String(candidateNumber))) throw Error("Candidate number must be numeric");
  const response = await fetchImpl(
    `https://huggingface.co/api/datasets/${repository}/discussions/${candidateNumber}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw Error(`Hugging Face candidate lookup failed (${response.status})`);
  const discussion = await response.json();
  const prefix = "Contribute benchmark observation ";
  if (
    !discussion.isPullRequest ||
    discussion.status !== "open" ||
    !discussion.title.startsWith(prefix)
  )
    throw Error("Candidate is not an open benchmark observation pull request");
  const runId = discussion.title.slice(prefix.length);
  if (!SAFE_SEGMENT.test(runId)) throw Error("Candidate title has an invalid run ID");
  const commits = discussion.events.filter((event) => event.type === "commit");
  const candidateCommit = commits.at(-1)?.data?.oid;
  if (!/^[a-f0-9]{40}$/.test(candidateCommit ?? ""))
    throw Error("Candidate has no immutable head commit");

  await mkdir(directory, { recursive: true });
  for (const name of CANDIDATE_FILES) {
    const blob = await hub.downloadFile({
      repo,
      path: `candidates/${runId}/${name}`,
      revision: candidateCommit,
      accessToken,
    });
    if (!blob) throw Error(`Candidate is missing ${name}`);
    await writeFile(path.join(directory, name), Buffer.from(await blob.arrayBuffer()), {
      flag: "wx",
    });
  }
  return { candidateCommit, runId };
}

/** Post the acceptance receipt and close a materialized Dataset candidate. */
export async function closeHuggingFaceCandidate(
  repository,
  candidateNumber,
  token,
  receipt,
  fetchImpl = fetch,
) {
  const response = await fetchImpl(
    `https://huggingface.co/api/datasets/${repository}/discussions/${candidateNumber}/status`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "closed", comment: receipt }),
    },
  );
  if (!response.ok)
    throw Error(
      `Hugging Face candidate close failed (${response.status}): ${await response.text()}`,
    );
}

export async function readDatasetIndex(snapshot) {
  try {
    return JSON.parse(await readFile(path.join(snapshot, "dataset-index.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { runs: [] };
    throw error;
  }
}

export function assertPreserved(currentIndex, nextIndex) {
  const next = new Map(nextIndex.runs.map((run) => [run.runId, run]));
  for (const run of currentIndex.runs ?? []) {
    const retained = next.get(run.runId);
    if (!retained) throw Error(`Dataset rebuild would drop existing observation ${run.runId}`);
    if (run.manifestSha256 && retained.manifestSha256 !== run.manifestSha256)
      throw Error(`Dataset rebuild would change existing observation ${run.runId}`);
  }
}

/**
 * Validate one ordinary candidate, append its immutable source and shards, and update compact views.
 * Historical source bundles and public data shards are never downloaded on this path.
 */
export async function acceptHuggingFaceCandidate({
  repository,
  candidateRevision,
  accessToken,
  workspaceDirectory,
  dryRun = false,
  hub = defaultHub,
  fetchImpl = fetch,
  close = closeHuggingFaceCandidate,
}) {
  const repo = datasetRepository(repository);
  const token = await resolveHuggingFaceToken({ accessToken });
  if (!token) throw Error("HF_TOKEN is required to accept a Hugging Face candidate");
  const candidateNumber = String(candidateRevision);
  if (!/^\d+$/.test(candidateNumber)) throw Error("Candidate number must be numeric");
  const parentCommit = await headCommit(hub, repo, token);
  const workspace = path.resolve(workspaceDirectory);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });

  const [sourceIndex, datasetIndex, aggregateState] = await Promise.all([
    downloadJson(hub, repo, parentCommit, token, "source/index.json"),
    downloadJson(hub, repo, parentCommit, token, "dataset-index.json"),
    downloadJson(hub, repo, parentCommit, token, "aggregate-state.json"),
  ]);
  verifyAggregateState(aggregateState, sourceIndex);

  const outputDirectory = path.join(workspace, "dataset");
  const candidate = path.join(workspace, "candidate");
  const { candidateCommit, runId: candidateRunId } = await downloadHuggingFaceCandidate({
    hub,
    repo,
    repository,
    candidateNumber,
    accessToken: token,
    directory: candidate,
    fetchImpl,
  });
  const runOutput = path.join(workspace, "run");
  const single = await buildPublicDataset(runOutput, [candidate]);
  if (single.runs[0].runId !== candidateRunId)
    throw Error("Candidate title does not match the normalized run ID");
  const existingRun = datasetIndex.runs.find((run) => run.runId === candidateRunId);
  if (existingRun) {
    if (existingRun.manifestSha256 !== single.runs[0].manifestSha256)
      throw Error("Candidate run ID already exists with different evidence");
    if (dryRun)
      return {
        index: datasetIndex,
        outputDirectory,
        commitOid: null,
        runId: candidateRunId,
        candidateCommit,
        operationCount: 0,
        duplicate: true,
      };
    let candidateClosed = true;
    let closeError = null;
    try {
      await close(
        repository,
        Number(candidateNumber),
        token,
        `Community observation ${candidateRunId} was already accepted on Dataset main at ${parentCommit}.`,
        fetchImpl,
      );
    } catch (error) {
      candidateClosed = false;
      closeError = String(error?.message ?? error);
    }
    return {
      index: datasetIndex,
      outputDirectory,
      commitOid: parentCommit,
      runId: candidateRunId,
      candidateCommit,
      candidateClosed,
      closeError,
      operationCount: 0,
      duplicate: true,
    };
  }
  const store = path.join(workspace, "store");
  await mkdir(store, { recursive: true });
  await writeFile(path.join(store, "index.json"), JSON.stringify(sourceIndex, null, 2) + "\n");
  const previousSourceIndex = structuredClone(sourceIndex);
  const accepted = await ingestCandidate(store, candidate);
  if (accepted.runId !== candidateRunId)
    throw Error("Candidate title does not match the normalized run ID");

  const nextSourceIndex = JSON.parse(await readFile(path.join(store, "index.json"), "utf8"));
  const sourceMetadata = nextSourceIndex.submissions.find((item) => item.runId === accepted.runId);
  if (!sourceMetadata) throw Error("Accepted candidate is missing source metadata");
  const run = {
    ...single.runs[0],
    submissionId: sourceMetadata.submissionId,
    ownerId: sourceMetadata.ownerId,
    purpose: sourceMetadata.purpose,
    verification: sourceMetadata.verification ?? "unverified",
    definitions: sourceMetadata.definitions,
  };
  const evidence = {
    profiles: parseJsonLines(await readFile(path.join(candidate, "profiles.jsonl"), "utf8")).map(
      (row) => ({ runId: accepted.runId, ...row }),
    ),
    trials: parseJsonLines(await readFile(path.join(candidate, "trials.jsonl"), "utf8")).map(
      (row) => ({ runId: accepted.runId, ...row }),
    ),
    rounds: parseJsonLines(await readFile(path.join(candidate, "rounds.jsonl"), "utf8")).map(
      (row) => ({ runId: accepted.runId, ...row }),
    ),
    toolCalls: parseJsonLines(await readFile(path.join(candidate, "tool-calls.jsonl"), "utf8")).map(
      (row) => ({ runId: accepted.runId, ...row }),
    ),
  };
  const nextAggregateState = appendAggregateRun(aggregateState, {
    previousSourceIndex,
    sourceIndex: nextSourceIndex,
    run,
    ...evidence,
  });
  datasetIndex.runs.push(run);

  const acceptedBundle = path.join(store, "accepted", sourceMetadata.submissionId);
  await mkdir(path.join(outputDirectory, "source", "accepted"), { recursive: true });
  await cp(
    acceptedBundle,
    path.join(outputDirectory, "source", "accepted", sourceMetadata.submissionId),
    { recursive: true },
  );
  for (const table of ["profiles", "configurations", "trials", "rounds", "tool-calls"]) {
    await mkdir(path.join(outputDirectory, "data", table), { recursive: true });
    await cp(
      path.join(runOutput, "data", table, `${accepted.runId}.jsonl.gz`),
      path.join(outputDirectory, "data", table, `${accepted.runId}.jsonl.gz`),
    );
  }
  await mkdir(path.join(outputDirectory, "source"), { recursive: true });
  const sourceContent = JSON.stringify(nextSourceIndex, null, 2) + "\n";
  await writeFile(path.join(outputDirectory, "source", "index.json"), sourceContent);
  datasetIndex.source = {
    path: "source/index.json",
    bytes: Buffer.byteLength(sourceContent),
    sha256: createHash("sha256").update(sourceContent).digest("hex"),
  };
  const index = await buildDerivedDatasetFromAggregateState(
    outputDirectory,
    datasetIndex,
    nextAggregateState,
  );
  const outputFiles = await directoryFiles(outputDirectory);
  if (dryRun)
    return {
      index,
      outputDirectory,
      commitOid: null,
      runId: accepted.runId,
      candidateCommit,
      operationCount: outputFiles.length,
    };

  const operations = outputFiles.map((file) => ({
    operation: "addOrUpdate",
    ...file,
  }));
  const result = await hub.commit({
    repo,
    accessToken: token,
    branch: "main",
    parentCommit,
    title: `Accept benchmark observation ${accepted.runId}`,
    operations,
  });
  const commitOid = result.commit.oid;
  if (!commitOid) throw Error("Hugging Face did not return a dataset commit");
  let candidateClosed = true;
  let closeError = null;
  try {
    await close(
      repository,
      Number(candidateNumber),
      token,
      `Accepted community observation ${accepted.runId} in Dataset commit ${commitOid}.`,
      fetchImpl,
    );
  } catch (error) {
    candidateClosed = false;
    closeError = String(error?.message ?? error);
  }
  return {
    index,
    outputDirectory,
    commitOid,
    runId: accepted.runId,
    candidateCommit,
    candidateClosed,
    closeError,
    operationCount: operations.length,
  };
}
