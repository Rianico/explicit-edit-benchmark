#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = "alexshpunt/explicit-edit-benchmark";

/** Collect every immutable revision that this repository trusts as its own code. */
export async function trustedCommitPins(root = process.cwd()) {
  const workflow = await readFile(path.join(root, ".github/workflows/official-run.yml"), "utf8");
  const policy = JSON.parse(
    await readFile(path.join(root, "policies/official-runs/v1.json"), "utf8"),
  );
  const pins = new Set(policy.workflows.flatMap(({ sha, runnerSha }) => [sha, runnerSha]));
  const checkout = /repository:\s*alexshpunt\/explicit-edit-benchmark\s*\n\s*ref:\s*([0-9a-f]+)/gu;
  for (const match of workflow.matchAll(checkout)) pins.add(match[1]);
  for (const pin of pins) if (!SHA.test(pin)) throw Error(`Invalid trusted commit pin: ${pin}`);
  return [...pins].sort();
}

/** Fail when a syntactically valid SHA does not exist in the canonical GitHub repository. */
export async function checkWorkflowPins({ root = process.cwd(), fetchImpl = fetch } = {}) {
  const pins = await trustedCommitPins(root);
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (const pin of pins) {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/commits/${pin}`, {
      headers,
    });
    if (!response.ok)
      throw Error(`Trusted commit does not exist on GitHub: ${pin} (${response.status})`);
  }
  return pins;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const pins = await checkWorkflowPins();
  console.log(`Verified ${pins.length} trusted GitHub commit pins.`);
}
