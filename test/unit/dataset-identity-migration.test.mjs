import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { migrateIdentityRows, replaceStrings } from "../../scripts/migrate-dataset-identity.mjs";

test("identity migration replaces canonical values and reconnects configuration references", () => {
  const oldConfiguration = {
    configurationId: "example/default",
    modelFamily: "model-old",
    modelVersion: "model-old",
    model: "provider/model-old",
    configurationHash: "previous-hash",
  };
  const rows = migrateIdentityRows(
    {
      "configurations.jsonl": [oldConfiguration],
      "profiles.jsonl": [
        {
          profileId: "example/default",
          modelFamily: "model-old",
          modelId: "provider/model-old",
          configurationHash: "previous-hash",
        },
      ],
      "trials.jsonl": [{ trialId: "trial-1", modelId: "provider/model-old" }],
      "rounds.jsonl": [],
      "tool-calls.jsonl": [],
    },
    "model-old",
    "model-current",
  );
  const configuration = rows["configurations.jsonl"][0];
  const { configurationHash, ...recipe } = configuration;
  assert.equal(
    configurationHash,
    createHash("sha256").update(JSON.stringify(recipe)).digest("hex"),
  );
  assert.equal(rows["profiles.jsonl"][0].configurationHash, configurationHash);
  assert.equal(rows["profiles.jsonl"][0].modelId, "provider/model-current");
  assert.equal(rows["trials.jsonl"][0].modelId, "provider/model-current");
  assert.doesNotMatch(JSON.stringify(rows), /model-old/);
});

test("generic replacement has no knowledge of a particular model", () => {
  assert.deepEqual(replaceStrings({ value: "provider/before" }, "before", "after"), {
    value: "provider/after",
  });
});
