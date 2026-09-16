import assert from "node:assert/strict";
import test from "node:test";
import { canonicalIdentityJson, executionIdentity } from "../../scripts/official-identities.mjs";

test("execution identity is stable across configuration order and delivery retries", () => {
  const input = {
    repository: "owner/runs",
    runId: "42",
    producerAttempt: 1,
    invocation: "benchmark",
    configurationHashes: ["b".repeat(64), "a".repeat(64)],
  };
  const first = executionIdentity(input);
  const redelivery = executionIdentity({
    ...input,
    configurationHashes: [...input.configurationHashes].reverse(),
  });
  assert.deepEqual(first, redelivery);
  assert.equal(first.executionId.length, 64);
});

test("new producer attempt changes execution identity", () => {
  const input = {
    repository: "owner/runs",
    runId: "42",
    producerAttempt: 1,
    invocation: "benchmark",
    configurationHashes: ["a".repeat(64)],
  };
  assert.notEqual(
    executionIdentity(input).executionId,
    executionIdentity({ ...input, producerAttempt: 2 }).executionId,
  );
});

test("canonical identity serialization ignores object key order", () => {
  assert.equal(
    canonicalIdentityJson({ b: 2, a: { d: 4, c: 3 } }),
    canonicalIdentityJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
});
