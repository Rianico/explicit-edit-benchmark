#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  throw Error("Usage: node scripts/analyze-model-harness-matrix.mjs BENCHMARK_JSON OUTPUT_JSON");
}

const benchmark = JSON.parse(await readFile(path.resolve(input), "utf8"));
const harnessNames = [
  "dsh-standard",
  "dsh-code",
  "opencode",
  "copilot",
  "vanilla",
  "codex",
  "ide",
  "omp",
];

function splitProfile(profile) {
  const harness = harnessNames.find((name) => profile.endsWith(`-${name}`));
  if (!harness) throw Error(`Unknown profile: ${profile}`);
  return { model: profile.slice(0, -harness.length - 1), harness };
}

function blank(name) {
  return {
    name,
    tasks: 0,
    firstPassed: 0,
    eventualPassed: 0,
    firstEofNormalized: 0,
    terminalEofNormalized: 0,
    recoveries: 0,
    roundSeconds: 0,
    timeouts: 0,
    infrastructureFailures: 0,
  };
}

function add(target, row) {
  for (const field of [
    "tasks",
    "firstPassed",
    "eventualPassed",
    "firstEofNormalized",
    "terminalEofNormalized",
    "recoveries",
    "roundSeconds",
    "timeouts",
    "infrastructureFailures",
  ]) {
    target[field] += Number(row[field] ?? 0);
  }
}

const byModel = new Map();
const byHarness = new Map();
for (const profile of benchmark.profiles) {
  const { model, harness } = splitProfile(profile.profile);
  if (!byModel.has(model)) byModel.set(model, blank(model));
  if (!byHarness.has(harness)) byHarness.set(harness, blank(harness));
  add(byModel.get(model), profile);
  add(byHarness.get(harness), profile);
}

const trialByKey = new Map(
  benchmark.trials.map((trial) => {
    const { model, harness } = splitProfile(trial.profile);
    return [`${model}\0${harness}\0${trial.task}`, trial];
  }),
);
const ideVsVanilla = [];
for (const model of byModel.keys()) {
  const counts = {
    model,
    tasks: 0,
    first: { both: 0, ideOnly: 0, vanillaOnly: 0, neither: 0 },
    eventual: { both: 0, ideOnly: 0, vanillaOnly: 0, neither: 0 },
  };
  const tasks = new Set(
    benchmark.trials
      .filter((trial) => splitProfile(trial.profile).model === model)
      .map((trial) => trial.task),
  );
  for (const task of tasks) {
    const ide = trialByKey.get(`${model}\0ide\0${task}`);
    const vanilla = trialByKey.get(`${model}\0vanilla\0${task}`);
    if (!ide || !vanilla) continue;
    counts.tasks++;
    for (const [stage, select] of [
      ["first", (trial) => Boolean(trial.rounds[0]?.passed)],
      ["eventual", (trial) => Boolean(trial.rounds.at(-1)?.passed)],
    ]) {
      const i = select(ide);
      const v = select(vanilla);
      counts[stage][i && v ? "both" : i ? "ideOnly" : v ? "vanillaOnly" : "neither"]++;
    }
  }
  ideVsVanilla.push(counts);
}

const analysis = {
  run: benchmark.run,
  generatedFrom: path.basename(input),
  byModel: [...byModel.values()],
  byHarness: [...byHarness.values()],
  ideVsVanilla,
};
await writeFile(path.resolve(output), `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`Wrote ${output}`);
