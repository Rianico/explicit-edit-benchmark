import assert from "node:assert/strict";
import test from "node:test";

import {
  completeRunEvidence,
  familyGroupScores,
  latestHarnessGroups,
  modelLeaderboard,
} from "../../scripts/build-public-dataset.mjs";

function row(version, taskIds, passed) {
  return {
    harnessFamily: "pi-agent-ide",
    harnessVersion: version,
    benchmarkTaskCount: 226,
    taskCount: taskIds.length,
    complete: taskIds.length === 226,
    coverage: taskIds.length / 226,
    firstExactRate: Number(passed),
    finalExactRate: Number(passed),
    qualityScore: Number(passed),
    score: Number(passed) * (taskIds.length / 226),
    observations: taskIds.length,
  };
}

test("published model rows keep providers separate", () => {
  const groups = {
    "mimo-v2.5\txiaomi": { score: 0.4 },
    "mimo-v2.5\topencode-go": { score: 0.9 },
  };
  const rows = [
    { modelFamily: "mimo-v2.5", provider: "xiaomi", harnessFamily: "pi", rankingEligible: true },
    {
      modelFamily: "mimo-v2.5",
      provider: "opencode-go",
      harnessFamily: "codex",
      rankingEligible: true,
    },
  ];

  assert.deepEqual(
    modelLeaderboard(groups, rows).map(({ modelFamily, provider, score }) => ({
      modelFamily,
      provider,
      score,
    })),
    [
      { modelFamily: "mimo-v2.5", provider: "opencode-go", score: 0.9 },
      { modelFamily: "mimo-v2.5", provider: "xiaomi", score: 0.4 },
    ],
  );
});

test("model routes are grouped by provider before the model family summary", () => {
  const rows = [
    {
      modelFamily: "mimo-v2.5",
      provider: "xiaomi",
      agentFamily: "agent",
      harnessFamily: "harness",
      thinking: "low",
      complete: true,
      rankingEligible: true,
      score: 0.4,
    },
    {
      modelFamily: "mimo-v2.5",
      provider: "opencode-go",
      agentFamily: "agent",
      harnessFamily: "harness",
      thinking: "low",
      complete: true,
      rankingEligible: true,
      score: 0.9,
    },
  ];

  const groups = familyGroupScores(rows);

  assert.equal(groups.modelRoute["mimo-v2.5\txiaomi"].score, 0.4);
  assert.equal(groups.modelRoute["mimo-v2.5\topencode-go"].score, 0.9);
  assert.equal(groups.modelFamily["mimo-v2.5"].score, 0.65);
});

test("task-family groups use slices from globally complete configurations", () => {
  const identity = {
    modelFamily: "model",
    agentFamily: "agent",
    harnessFamily: "harness",
    harnessVersion: "1.0.0",
    thinking: "low",
  };
  const eligible = { ...identity, complete: true, score: 0.8 };
  const taskFamilySlice = {
    ...identity,
    complete: false,
    score: 0.6,
    qualityScore: 0.75,
    coverage: 0.8,
  };

  const groups = familyGroupScores([taskFamilySlice], [eligible], "qualityScore");

  assert.equal(groups.harnessFamily.harness.score, 0.75);
  assert.equal(groups.harnessFamily.harness.completeConfigurationCount, 1);
});

test("badge score uses the latest complete harness version", () => {
  const completeTasks = Array.from({ length: 226 }, (_, index) => `task-${index}`);
  const groups = latestHarnessGroups([
    row("0.5.0", completeTasks, true),
    row("0.5.1", completeTasks, false),
  ]);
  const badge = groups["pi-agent-ide"];
  assert.equal(badge.harnessVersion, "0.5.1");
  assert.equal(badge.coverage, 1);
  assert.equal(badge.taskCount, 226);
  assert.equal(badge.score, 0);
});

test("badge score excludes quarantined configurations", () => {
  const completeTasks = Array.from({ length: 226 }, (_, index) => `task-${index}`);
  const groups = latestHarnessGroups([
    { ...row("0.5.1", completeTasks, true), rankingEligible: true },
    { ...row("0.5.1", completeTasks, false), rankingEligible: false },
  ]);

  assert.equal(groups["pi-agent-ide"].score, 1);
  assert.equal(groups["pi-agent-ide"].completeConfigurationCount, 1);
});

test("badge evidence excludes an incomplete run entirely", () => {
  const taskIds = ["task-0", "task-1"];
  const index = {
    runs: ["full", "partial"].map((runId) => ({
      runId,
      definitions: { taskSet: { taskIds } },
    })),
  };
  const profiles = [
    { runId: "full", profileId: "profile" },
    { runId: "partial", profileId: "profile" },
  ];
  const trials = [
    ...taskIds.map((taskId) => ({ runId: "full", profileId: "profile", taskId })),
    { runId: "partial", profileId: "profile", taskId: "task-0" },
  ];
  const evidence = completeRunEvidence(index, profiles, trials, []);
  assert.deepEqual(
    evidence.index.runs.map((run) => run.runId),
    ["full"],
  );
  assert.equal(evidence.trials.length, 2);
});
