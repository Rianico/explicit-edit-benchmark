#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SHA = /^[0-9a-f]{40}$/u;
const WORKFLOW = ".github/workflows/official-run.yml";
const POLICY = "policies/official-runs/v1.json";

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function commitSha(root, revision = "HEAD") {
  const sha = git(root, "rev-parse", "--verify", `${revision}^{commit}`);
  if (!SHA.test(sha)) throw Error(`Git did not resolve a full commit SHA: ${revision}`);
  return sha;
}

function commit(root, message, files) {
  git(root, "add", "--", ...files);
  git(root, "commit", "-m", message);
  return commitSha(root);
}

function requireClean(root) {
  const dirty = git(root, "status", "--porcelain");
  if (dirty) throw Error(`Release checkout must be clean:\n${dirty}`);
}

export function pinCallerTemplate(text, workflowSha, policySha) {
  let count = 0;
  const updated = text.replace(
    /(official-run\.yml@|signer_sha:\s*)[0-9a-f]{40}/gu,
    (match, prefix) => {
      count += 1;
      return `${prefix}${workflowSha}`;
    },
  );
  if (count !== 2) throw Error(`Unexpected caller workflow pin layout: ${count}`);
  let submitCount = 0;
  const complete = updated.replace(
    /(official-submit\.yml@|policy_sha:\s*)[0-9a-f]{40}/gu,
    (match, prefix) => {
      submitCount += 1;
      return `${prefix}${policySha}`;
    },
  );
  if (submitCount !== 3) throw Error(`Unexpected caller policy/submit pin layout: ${submitCount}`);
  return complete;
}

/**
 * Read the committed workflow revision from Git, approve that same revision as signer and runner,
 * then update the caller template. Callers never type, copy, or complete a SHA by hand.
 */
export async function releaseOfficialWorkflow({ root = process.cwd(), templateDirectory }) {
  root = path.resolve(root);
  templateDirectory = path.resolve(templateDirectory);
  requireClean(root);
  requireClean(templateDirectory);
  if (git(root, "branch", "--show-current") === "main")
    throw Error("Create a release branch before updating official workflow pins");

  const runnerSha = commitSha(root);
  const policyFile = path.join(root, POLICY);
  const policy = JSON.parse(await readFile(policyFile, "utf8"));
  if (
    !policy.workflows.some(
      ({ sha, runnerSha: runner }) => sha === runnerSha && runner === runnerSha,
    )
  )
    policy.workflows.push({ sha: runnerSha, runnerSha, status: "active" });
  await writeFile(policyFile, `${JSON.stringify(policy, null, 2)}\n`);
  execFileSync("npx", ["--no-install", "oxfmt", POLICY], {
    cwd: root,
    stdio: "inherit",
  });
  const policySha = commit(root, "Approve official workflow release", [POLICY]);

  const templateFile = path.join(templateDirectory, WORKFLOW);
  await writeFile(
    templateFile,
    pinCallerTemplate(await readFile(templateFile, "utf8"), runnerSha, policySha),
  );
  const templateSha = commit(templateDirectory, "Pin official benchmark workflow release", [
    WORKFLOW,
  ]);

  return { workflowSha: runnerSha, policySha, templateSha };
}

async function main() {
  const { values } = parseArgs({ options: { "template-directory": { type: "string" } } });
  if (!values["template-directory"])
    throw Error("Usage: release-official-workflow --template-directory PATH");
  const result = await releaseOfficialWorkflow({ templateDirectory: values["template-directory"] });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
