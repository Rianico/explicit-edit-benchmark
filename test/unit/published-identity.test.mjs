import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { safeConfiguration, rehashConfiguration } from "../../scripts/normalized-run.mjs";
import { assertDeclaredHarnessVersions } from "../../scripts/benchmark-ingestion.mjs";

/** Every source file below a directory, so the guard sees new files too. */
async function walk(relative) {
  const found = [];
  for (const entry of await readdir(relative, { withFileTypes: true })) {
    const target = path.join(relative, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(target)));
    else found.push(target);
  }
  return found;
}

const adapter = {
  configurationId: "pi-default/default",
  agentFamily: "pi",
  agentVersion: "0.85.1",
  modelFamily: "gpt-5.6-luna",
  modelVersion: "gpt-5.6-luna",
  provider: "openai-codex",
  harnessFamily: "pi-default",
  harnessVersion: "0.85.1",
  adapterVersion: "1",
  model: "openai-codex/gpt-5.6-luna",
  thinking: "low",
  configurationLabels: ["harness/pi-default", "transport/harness-native"],
  kind: "pi-default",
  configuration: {
    tools: ["default"],
    extensions: [],
    rules: [],
    runtimeFlags: [],
    environment: [],
  },
};

await test("a published configuration can be re-hashed after a documented rename", () => {
  const row = safeConfiguration(adapter);
  assert.equal(rehashConfiguration(row).configurationHash, row.configurationHash);
  const renamed = rehashConfiguration({ ...row, harnessKind: "pi-agent-ide" });
  assert.notEqual(renamed.configurationHash, row.configurationHash);
  assert.deepEqual(Object.keys(renamed), Object.keys(row));
});

await test("a declared harness version has to be one the bundle actually ran", () => {
  const harnesses = [{ id: "opencode-default", version: "1.16.2" }];
  assert.doesNotThrow(() =>
    assertDeclaredHarnessVersions(harnesses, [
      { harnessId: "opencode-default", harnessVersion: "1.18.29" },
      { harnessId: "opencode-default", harnessVersion: "1.16.2" },
    ]),
  );
  assert.throws(
    () =>
      assertDeclaredHarnessVersions(harnesses, [
        { harnessId: "opencode-default", harnessVersion: "9.9.9" },
      ]),
    /declares version 1\.16\.2, but this bundle only ran 9\.9\.9/,
  );
  assert.throws(
    () => assertDeclaredHarnessVersions(harnesses, [{ harnessId: "pi-default" }]),
    /undeclared harness/,
  );
});

await test("one module owns the benchmark identity", async () => {
  const home = "src/suites/explicit-edit/version.ts";
  const literals = [
    '"explicit-edit-v1"',
    '"explicit-edit/explicit-edit"',
    '"explicit-edit-benchmark"',
  ];
  const offenders = [];
  // Production code only: a test fixture may legitimately spell out an identity value.
  for (const directory of ["scripts", "src"]) {
    for (const file of await walk(directory)) {
      if (file === home || !/\.(mjs|ts)$/.test(file)) continue;
      const text = await readFile(file, "utf8");
      for (const literal of literals)
        if (text.includes(literal)) offenders.push(`${file}: ${literal}`);
    }
  }
  assert.deepEqual(offenders, []);
});
