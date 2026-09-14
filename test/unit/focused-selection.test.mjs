import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFocused, selectedTasks } from "../../scripts/focused-selection.mjs";

await test("excludes only shared passes; includes missing, failed and timed-out outcomes", () => {
  const tasks = ["pass", "failed", "missing", "timeout"].map((id) => ({ id, fixtureSha256: id }));
  const rows = tasks.flatMap((t) =>
    ["a", "b"].map((profile) => ({ taskId: t.id, profile, eofNormalizedPassed: true })),
  );
  rows.find((r) => r.taskId === "failed").eofNormalizedPassed = false;
  rows.find((r) => r.taskId === "timeout").timedOut = true;
  const selection = selectFocused(
    tasks,
    rows.filter((r) => !(r.taskId === "missing" && r.profile === "b")),
    ["a", "b"],
  );
  assert.deepEqual(
    selection.excluded.map((t) => t.id),
    ["pass"],
  );
  assert.deepEqual(
    selection.included.map((t) => t.id),
    ["failed", "missing", "timeout"],
  );
  assert.equal(selection.included[1].reasons[0].reason, "missing-or-unknown");
  assert.deepEqual(
    selectedTasks(tasks, selection).map((t) => t.id),
    ["failed", "missing", "timeout"],
  );
  selection.included[0].fixtureSha256 = "drift";
  assert.throws(() => selectedTasks(tasks, selection), /changed task/);
  assert.throws(() => selectFocused(tasks, [...rows, rows[0]], ["a", "b"]), /Duplicate/);
});
