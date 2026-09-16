import { readFile } from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label}: expected object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(`${label}: expected fields ${expected.join(", ")}; got ${actual.join(", ")}`);
}

/** Load and strictly validate a repository-owned official-run release policy. */
export async function loadOfficialPolicy(file) {
  const source = typeof file === "string" ? path.resolve(file) : file;
  const policy = JSON.parse(await readFile(source, "utf8"));
  exactKeys(
    policy,
    [
      "schemaVersion",
      "policyId",
      "attestation",
      "workflows",
      "runner",
      "benchmark",
      "normalizedSchemas",
      "runPolicy",
    ],
    "policy",
  );
  if (policy.schemaVersion !== 1 || !/^official-runs-v[1-9][0-9]*$/.test(policy.policyId))
    throw Error("policy: unsupported identity or schema");
  exactKeys(
    policy.attestation,
    ["issuer", "predicateType", "signerWorkflow", "denySelfHosted"],
    "policy.attestation",
  );
  if (policy.attestation.issuer !== "https://token.actions.githubusercontent.com")
    throw Error("policy.attestation: unsupported issuer");
  if (policy.attestation.predicateType !== "https://slsa.dev/provenance/v1")
    throw Error("policy.attestation: unsupported predicate type");
  if (policy.attestation.denySelfHosted !== true)
    throw Error("policy.attestation: self-hosted must be denied");
  if (!Array.isArray(policy.workflows) || !policy.workflows.length)
    throw Error("policy.workflows: at least one workflow is required");
  for (const [index, workflow] of policy.workflows.entries()) {
    exactKeys(workflow, ["sha", "runnerSha", "status"], `policy.workflows[${index}]`);
    if (!COMMIT.test(workflow.sha) || !COMMIT.test(workflow.runnerSha))
      throw Error(`policy.workflows[${index}]: invalid commit SHA`);
    if (!["active", "revoked"].includes(workflow.status))
      throw Error(`policy.workflows[${index}]: invalid status`);
  }
  exactKeys(policy.benchmark, ["repository"], "policy.benchmark");
  if (policy.benchmark.repository !== "alexshpunt/explicit-edit-benchmark")
    throw Error("policy.benchmark: unsupported repository");
  exactKeys(
    policy.runner,
    ["contract", "taskSetSha256", "verifierSha256", "tasks"],
    "policy.runner",
  );
  if (!SHA256.test(policy.runner.taskSetSha256) || !SHA256.test(policy.runner.verifierSha256))
    throw Error("policy.runner: invalid identity hash");
  if (typeof policy.runner.contract !== "string" || !policy.runner.contract)
    throw Error("policy.runner: invalid contract");
  if (!Array.isArray(policy.runner.tasks) || !policy.runner.tasks.length)
    throw Error("policy.runner.tasks: empty task registry");
  const ids = new Set();
  for (const [index, task] of policy.runner.tasks.entries()) {
    exactKeys(task, ["id", "fixtureSha256"], `policy.runner.tasks[${index}]`);
    if (
      typeof task.id !== "string" ||
      !task.id ||
      !SHA256.test(task.fixtureSha256) ||
      ids.has(task.id)
    )
      throw Error(`policy.runner.tasks[${index}]: invalid task identity`);
    ids.add(task.id);
  }
  if (
    !Array.isArray(policy.normalizedSchemas) ||
    !policy.normalizedSchemas.length ||
    policy.normalizedSchemas.some((version) => !Number.isInteger(version))
  )
    throw Error("policy.normalizedSchemas: invalid schema list");
  exactKeys(
    policy.runPolicy,
    ["partialRuns", "oracleRecoveries", "retryFailures", "concurrency", "timeoutMs"],
    "policy.runPolicy",
  );
  if (policy.runPolicy.partialRuns !== true)
    throw Error("policy.runPolicy: partial runs must be allowed");
  for (const key of ["oracleRecoveries", "retryFailures", "concurrency", "timeoutMs"])
    if (!Number.isInteger(policy.runPolicy[key]) || policy.runPolicy[key] < 0)
      throw Error(`policy.runPolicy: invalid ${key}`);
  return policy;
}

/** Resolve an active workflow to its immutable runner revision. */
export function approvedWorkflow(policy, signerSha) {
  if (!COMMIT.test(signerSha)) throw Error("Invalid signer workflow SHA");
  const entry = policy.workflows.find((candidate) => candidate.sha === signerSha);
  if (!entry) throw Error(`Unknown signer workflow SHA: ${signerSha}`);
  if (entry.status !== "active") throw Error(`Revoked signer workflow SHA: ${signerSha}`);
  return entry;
}
