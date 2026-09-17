import assert from "node:assert/strict";
import test from "node:test";
import { ADAPTER_IDS } from "../../scripts/adapter-registry.mjs";
import { componentSources } from "../../scripts/component-sources.mjs";

test("every runnable adapter publishes repository and package sources", () => {
  const sources = componentSources();
  assert.deepEqual(Object.keys(sources.harnesses).sort(), [...ADAPTER_IDS].sort());
  for (const source of Object.values(sources.harnesses)) {
    assert.match(source.repositoryUrl, /^https:\/\/github\.com\//u);
    assert.match(source.packageUrl, /^https:\/\/www\.npmjs\.com\/package\//u);
    assert.ok(source.packageName);
  }
});

test("known model families publish official pages without affecting configuration identity", () => {
  const sources = componentSources();
  assert.equal(
    sources.models["gpt-5.6-luna"].officialPageUrl,
    "https://developers.openai.com/api/docs/models",
  );
  assert.match(sources.models["deepseek-v4.1-flash"].officialPageUrl, /^https:/u);
});
