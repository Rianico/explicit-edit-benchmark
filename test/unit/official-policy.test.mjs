import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approvedWorkflow,
  loadOfficialPolicy,
  runPolicyForLifecycle,
} from "../../scripts/official-policy.mjs";
import { NORMALIZED_SCHEMA_VERSION } from "../../scripts/normalized-run.mjs";

const policyFile = new URL("../../policies/official-runs/v1.json", import.meta.url);

async function changedPolicy(change) {
  const policy = JSON.parse(await readFile(policyFile, "utf8"));
  change(policy);
  const root = await mkdtemp(path.join(tmpdir(), "official-policy-"));
  const file = path.join(root, "policy.json");
  await writeFile(file, JSON.stringify(policy));
  return file;
}

test("only an active signer workflow SHA resolves to its pinned runner", async () => {
  const policy = await loadOfficialPolicy(policyFile);
  const active = policy.workflows[0];
  assert.equal(approvedWorkflow(policy, active.sha).runnerSha, active.runnerSha);
  assert.throws(() => approvedWorkflow(policy, "a".repeat(40)), /Unknown signer/);
  assert.throws(() => approvedWorkflow(policy, "b".repeat(40)), /Unknown signer/);
  active.status = "revoked";
  assert.throws(() => approvedWorkflow(policy, active.sha), /Revoked signer/);
});

test("full and partial measurements use their exact approved run policies", async () => {
  const policy = await loadOfficialPolicy(policyFile);
  assert.deepEqual(runPolicyForLifecycle(policy, "partial-measurement"), policy.runPolicy);
  assert.deepEqual(runPolicyForLifecycle(policy, "full-measurement"), policy.fullRunPolicy);
  assert.equal(policy.fullRunPolicy.oracleRecoveries, 5);
  assert.equal(policy.fullRunPolicy.concurrency, 10);
});

test("release policy allows the schema produced by the current exporter", async () => {
  const policy = await loadOfficialPolicy(policyFile);
  assert.ok(policy.normalizedSchemas.includes(NORMALIZED_SCHEMA_VERSION));
});
test("release policy rejects extra and missing fields", async () => {
  await assert.rejects(
    loadOfficialPolicy(await changedPolicy((policy) => (policy.candidatePolicy = {}))),
    /expected fields/,
  );
  await assert.rejects(
    loadOfficialPolicy(await changedPolicy((policy) => delete policy.runner.verifierSha256)),
    /expected fields/,
  );
});

test("release policy rejects candidate changes to task, verifier, and contract identity", async () => {
  await assert.rejects(
    loadOfficialPolicy(await changedPolicy((policy) => (policy.runner.verifierSha256 = "wrong"))),
    /invalid identity hash/,
  );
  await assert.rejects(
    loadOfficialPolicy(
      await changedPolicy((policy) => (policy.runner.tasks[0].fixtureSha256 = "wrong")),
    ),
    /invalid task identity/,
  );
  await assert.rejects(
    loadOfficialPolicy(await changedPolicy((policy) => (policy.runner.contract = ""))),
    /contract/,
  );
});
