#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Remove one explicitly selected canonical submission and its retained official proof. */
export async function removeDatasetSubmission(storeDirectory, runId) {
  const root = path.resolve(storeDirectory);
  const indexFile = path.join(root, "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8"));
  const matches = index.submissions.filter((item) => item.runId === runId);
  if (matches.length !== 1) throw Error(`Expected exactly one submission for run ${runId}`);
  const [submission] = matches;
  index.submissions = index.submissions.filter((item) => item !== submission);
  await rm(path.join(root, "accepted", submission.submissionId), { recursive: true });
  if (submission.clientRunId)
    await rm(path.join(root, "official", submission.clientRunId), {
      recursive: true,
      force: true,
    });
  await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  return {
    runId,
    submissionId: submission.submissionId,
    executionId: submission.clientRunId ?? null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [store, runId] = process.argv.slice(2);
  if (!store || !runId) throw Error("Usage: remove-dataset-submission STORE RUN_ID");
  console.log(JSON.stringify(await removeDatasetSubmission(store, runId), null, 2));
}
