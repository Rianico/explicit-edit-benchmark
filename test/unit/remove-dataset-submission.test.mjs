import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeDatasetSubmission } from "../../scripts/remove-dataset-submission.mjs";

test("removing one run deletes only its evidence and official proof", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "remove-submission-"));
  const removed = {
    runId: "official-22-1",
    submissionId: "removed",
    clientRunId: "execution-22",
  };
  const kept = { runId: "official-23-1", submissionId: "kept", clientRunId: "execution-23" };
  await Promise.all([
    mkdir(path.join(root, "accepted", "removed"), { recursive: true }),
    mkdir(path.join(root, "accepted", "kept"), { recursive: true }),
    mkdir(path.join(root, "official", "execution-22"), { recursive: true }),
    mkdir(path.join(root, "official", "execution-23"), { recursive: true }),
  ]);
  await writeFile(
    path.join(root, "index.json"),
    JSON.stringify({ schemaVersion: 1, submissions: [removed, kept] }),
  );

  assert.deepEqual(await removeDatasetSubmission(root, removed.runId), {
    runId: removed.runId,
    submissionId: removed.submissionId,
    executionId: removed.clientRunId,
  });
  const index = JSON.parse(await readFile(path.join(root, "index.json"), "utf8"));
  assert.deepEqual(index.submissions, [kept]);
  await assert.rejects(readFile(path.join(root, "accepted", "removed", "manifest.json")), {
    code: "ENOENT",
  });
  assert.equal((await readFile(path.join(root, "index.json"), "utf8")).includes("kept"), true);
});
