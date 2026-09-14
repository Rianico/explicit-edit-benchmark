import test from "node:test";
import assert from "node:assert/strict";
import {
  compareText,
  differenceKind,
  actionEvidence,
  summarizeFailures,
} from "../../scripts/oracle-failure-evidence.mjs";

await test("separates EOF, internal layout and Unicode without changing outcomes", () => {
  const round = (a, b) => ({ passed: false, changes: [compareText(a, b)] });
  assert.equal(differenceKind(round("a\n", "a\n\n")), "eof");
  assert.equal(differenceKind(round("a\nb", "a\n\nb")), "line-breaks");
  assert.equal(differenceKind(round(" a", "a")), "ascii-layout");
  assert.equal(differenceKind(round("a\u00a0b", "a b")), "other-text");
  assert.equal(differenceKind({ passed: false, timedOut: true, changes: [] }), "execution-only");
});
await test("marks unavailable native Codex patches rather than inventing requests", () => {
  const action = actionEvidence(
    { item: { type: "file_change", changes: [{ path: "a" }], status: "completed" } },
    0,
  );
  assert.equal(action.args.patchUnavailable, true);
  assert.equal(action.index, 1);
});
await test("keeps infrastructure failures with no oracle rounds", () => {
  const result = summarizeFailures([{ id: "broken", profile: "x", passed: false, rounds: [] }]).x;
  assert.equal(result.chains, 1);
  assert.equal(result.exhausted, 1);
  assert.equal(result.initial.infrastructure, 1);
  assert.equal(result.terminal.infrastructure, 1);
});
await test("counts chains separately from rounds and records damaging recovery", () => {
  const rounds = [
    { passed: false, changes: [compareText("a\n", "a")] },
    { passed: false, changes: [compareText("b", "a")] },
    { passed: true, changes: [] },
  ];
  const result = summarizeFailures([{ id: "one", profile: "x", passed: true, rounds }]).x;
  assert.equal(result.chains, 1);
  assert.equal(result.rounds, 3);
  assert.equal(result.recovered, 1);
  assert.deepEqual(result.layoutToOtherText, ["one"]);
});
