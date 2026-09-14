import { test } from "node:test";
import assert from "node:assert/strict";
import { oracleFeedback, recoverWithOracle } from "../../scripts/oracle-recovery.mjs";

await test("oracle feedback excludes expected content and internal errors", () => {
  const feedback = oracleFeedback(
    {
      exactMatch: false,
      differingFiles: ["a.txt"],
      expected: "SECRET_EXPECTED",
      diff: "SECRET_DIFF",
    },
    { error: "SECRET_PATH" },
  );
  assert.ok(feedback.includes("a.txt"));
  assert.ok(!feedback.includes("SECRET"));
});

await test("continues after failure and stops at first pass, recording every result", async () => {
  let calls = 0;
  const records = [];
  const result = await recoverWithOracle({
    recoveries: 5,
    run: async ({ attempt, feedback }) => {
      assert.equal(attempt, calls++);
      assert.equal(typeof feedback, attempt === 0 ? "undefined" : "string");
      return { exitCode: 0 };
    },
    verify: async () => ({ exactMatch: calls === 2 }),
    record: async (result) => records.push(result),
  });
  assert.equal(calls, 2);
  assert.equal(records.length, 2);
  assert.equal(result.firstAttemptPassed, false);
  assert.equal(result.eventuallyPassed, true);
  assert.equal(result.recoveriesUsed, 1);
});

await test("timeout is a failure even if workspace matches; exhaustion respects budget", async () => {
  const result = await recoverWithOracle({
    recoveries: 2,
    run: async () => ({ exitCode: 0, timedOut: true }),
    verify: async () => ({ exactMatch: true }),
    record: async () => {},
  });
  assert.equal(result.attempts.length, 3);
  assert.equal(result.eventuallyPassed, false);
  assert.equal(result.exhausted, true);
});
