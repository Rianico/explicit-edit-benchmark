import assert from "node:assert/strict";
import test from "node:test";
import { formatBadgeCount } from "../../scripts/build-public-dataset.mjs";

test("formats Dataset badge counts compactly", () => {
  assert.equal(formatBadgeCount(5), "5");
  assert.equal(formatBadgeCount(999), "999");
  assert.equal(formatBadgeCount(1_400), "1.4k");
  assert.equal(formatBadgeCount(14_012), "14k");
  assert.equal(formatBadgeCount(1_500_000), "1.5m");
});
