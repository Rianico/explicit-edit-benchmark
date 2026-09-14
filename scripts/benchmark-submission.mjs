import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateNormalizedRun } from "./validate-normalized-run.mjs";

const TABLES = [
  "profiles.jsonl",
  "configurations.jsonl",
  "trials.jsonl",
  "rounds.jsonl",
  "tool-calls.jsonl",
];

/** Build the strict upload envelope from a normalized bundle and safe submission metadata. */
export async function buildSubmission(bundleDirectory, options) {
  const root = path.resolve(bundleDirectory);
  const manifest = await validateNormalizedRun(root);
  if (!options.definitions?.runner) throw Error("Submission requires runner definition");
  const tables = Object.fromEntries(
    await Promise.all(
      TABLES.map(async (name) => [name, await readFile(path.join(root, name), "utf8")]),
    ),
  );
  return {
    schemaVersion: 1,
    clientRunId: options.clientRunId ?? manifest.runId,
    purpose: options.purpose,
    definitions: options.definitions,
    bundle: { manifest, tables },
  };
}

/** Upload one normalized bundle to an authenticated ingestion endpoint. */
export async function uploadSubmission(endpoint, apiKey, submission) {
  const response = await fetch(new URL("/v1/submissions", endpoint), {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(`Submission failed (${response.status}): ${result.message ?? result.code}`);
  return result;
}
