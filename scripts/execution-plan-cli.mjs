#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  installedDependencyFingerprint,
  resolveExecutionPlan,
  selectOfficialCredential,
} from "./execution-plan.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

const [command, ...args] = process.argv.slice(2);
if (command === "resolve") {
  const [inputFile, outputFile] = args;
  if (!inputFile || !outputFile)
    throw Error("Usage: execution-plan-cli.mjs resolve INPUT_JSON OUTPUT_JSON");
  const plan = await resolveExecutionPlan(await readJson(inputFile));
  await writeFile(path.resolve(outputFile), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
} else if (command === "credential") {
  const [storeFile, planFile, outputFile] = args;
  if (!storeFile || !planFile || !outputFile)
    throw Error("Usage: execution-plan-cli.mjs credential STORE_JSON PLAN_JSON OUTPUT_JSON");
  const selected = selectOfficialCredential(await readJson(storeFile), await readJson(planFile));
  await writeFile(path.resolve(outputFile), `${JSON.stringify(selected)}\n`, { mode: 0o600 });
} else if (command === "fingerprint") {
  const [runtimeDirectory, planFile, outputFile] = args;
  if (!runtimeDirectory || !planFile || !outputFile)
    throw Error("Usage: execution-plan-cli.mjs fingerprint RUNTIME PLAN_JSON OUTPUT_JSON");
  const result = await installedDependencyFingerprint(runtimeDirectory, await readJson(planFile));
  await writeFile(path.resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`);
} else {
  throw Error("Usage: execution-plan-cli.mjs <resolve|credential|fingerprint> ...");
}
