import assert from "node:assert/strict";
import test from "node:test";
import { checkWorkflowPins, trustedCommitPins } from "../../scripts/check-workflow-pins.mjs";

test("every trusted workflow and runner pin is a full commit SHA", async () => {
  const pins = await trustedCommitPins();
  assert.ok(pins.length > 0);
  assert.ok(pins.every((pin) => /^[0-9a-f]{40}$/u.test(pin)));
});

test("pin verification rejects a fabricated but well-formed commit", async () => {
  let calls = 0;
  await assert.rejects(
    checkWorkflowPins({
      fetchImpl: async () => ({ ok: ++calls !== 2, status: 404 }),
    }),
    /does not exist on GitHub/,
  );
});
