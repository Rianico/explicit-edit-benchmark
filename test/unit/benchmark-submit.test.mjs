import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSmokePassed,
  declaredHarnesses,
  submitOptions,
} from "../../scripts/benchmark-submit.mjs";

await test("uses one fixed comparable run policy", () => {
  assert.deepEqual(
    submitOptions(["--harness", "pi-default", "--model", "openai/gpt-5", "--thinking", "high"]),
    {
      concurrency: 10,
      oracleRecoveries: 5,
      timeoutSeconds: 120,
      config: null,
      prepareArgs: ["--harness", "pi-default", "--model", "openai/gpt-5", "--thinking", "high"],
    },
  );
  const withConcurrency = submitOptions([
    "--harness",
    "pi-default",
    "--model",
    "m",
    "--thinking",
    "low",
    "--concurrency",
    "3",
  ]);
  assert.equal(withConcurrency.concurrency, 3);
  const withTimeout = submitOptions(["--config", "harness.mjs", "--timeout-seconds", "900"]);
  assert.equal(withTimeout.timeoutSeconds, 900);
  assert.equal(withTimeout.config, "harness.mjs");
  assert.throws(
    () => submitOptions(["--config", "f", "--timeout-seconds", "0"]),
    /positive integer/,
  );
  // The adapter preparer rejects unknown options, so run policy never reaches it.
  assert.deepEqual(withConcurrency.prepareArgs, [
    "--harness",
    "pi-default",
    "--model",
    "m",
    "--thinking",
    "low",
  ]);
});

await test("needs harness, model and thinking for a ready adapter", () => {
  assert.throws(
    () => submitOptions(["--harness", "pi-default", "--model", "m"]),
    /requires --thinking/,
  );
  assert.throws(() => submitOptions([]), /requires --harness, --model, --thinking/);
});

await test("rejects unknown, duplicate and invalid options", () => {
  assert.throws(
    () =>
      submitOptions(["--harness", "pi-default", "--model", "m", "--thinking", "low", "--smoke"]),
    /Unknown option/,
  );
  assert.throws(
    () =>
      submitOptions([
        "--harness",
        "pi-default",
        "--harness",
        "pi-agent-ide",
        "--model",
        "m",
        "--thinking",
        "low",
      ]),
    /Duplicate option/,
  );
  assert.throws(
    () => submitOptions(["--config", "c.ts", "--concurrency", "0"]),
    /positive integer/,
  );
});

await test("keeps a custom config as a separate path", () => {
  assert.deepEqual(submitOptions(["--config", "benchmark.config.ts"]), {
    concurrency: 10,
    oracleRecoveries: 5,
    timeoutSeconds: 120,
    config: "benchmark.config.ts",
    prepareArgs: [],
  });
  assert.throws(() => submitOptions(["--config", "c.ts", "--harness", "pi-default"]), /not both/);
});

await test("keeps repeatable runtime mounts", () => {
  assert.deepEqual(
    submitOptions([
      "--harness",
      "pi-default",
      "--model",
      "m",
      "--thinking",
      "low",
      "--runtime",
      "/opt/a",
      "--runtime",
      "/opt/b",
    ]).prepareArgs,
    [
      "--harness",
      "pi-default",
      "--model",
      "m",
      "--thinking",
      "low",
      "--runtime",
      "/opt/a",
      "--runtime",
      "/opt/b",
    ],
  );
});

await test("declares one harness per published harness id", () => {
  assert.deepEqual(
    declaredHarnesses([
      { harnessId: "pi-agent-ide", harnessVersion: "0.5.0", configurationHash: "a" },
      { harnessId: "pi-agent-ide", harnessVersion: "0.5.0", configurationHash: "b" },
      { harnessId: "pi-default", harnessVersion: "0.85.1", configurationHash: "c" },
    ]),
    [
      { id: "pi-agent-ide", name: "pi-agent-ide", version: "0.5.0", sourceHash: "a" },
      { id: "pi-default", name: "pi-default", version: "0.85.1", sourceHash: "c" },
    ],
  );
});

await test("requires one successful smoke trial from every profile", () => {
  assert.doesNotThrow(() =>
    assertSmokePassed(
      {
        profiles: {
          "pi-default": { trials: 1, passed: 1 },
          "codex-cli-default": { trials: 1, passed: 1 },
        },
      },
      ["pi-default", "codex-cli-default"],
    ),
  );
  assert.throws(
    () =>
      assertSmokePassed(
        {
          profiles: {
            "pi-default": { trials: 1, passed: 1 },
            "codex-cli-default": { trials: 1, passed: 0 },
          },
        },
        ["pi-default", "codex-cli-default"],
      ),
    /Smoke failed for: codex-cli-default/,
  );
});
