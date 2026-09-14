/** Compare retained text without changing the recorded verifier outcome. Offsets use UTF-16 code units. */
export function compareText(actual, expected) {
  const trimEof = (s) => s.replace(/(?:\r\n|\n)+$/u, "");
  const stripLines = (s) => s.replace(/[\r\n]/gu, "");
  const stripLayout = (s) => s.replace(/[\r\n\t ]/gu, "");
  let first = 0;
  while (first < Math.min(actual.length, expected.length) && actual[first] === expected[first])
    first++;
  let suffix = 0;
  while (
    suffix < Math.min(actual.length, expected.length) - first &&
    actual.at(-suffix - 1) === expected.at(-suffix - 1)
  )
    suffix++;
  return {
    actualLength: actual.length,
    expectedLength: expected.length,
    onlyEof: trimEof(actual) === trimEof(expected),
    onlyLineBreaks: stripLines(actual) === stripLines(expected),
    onlyAsciiLayout: stripLayout(actual) === stripLayout(expected),
    firstDifference: first,
    actual: actual.slice(Math.max(0, first - 70), actual.length - suffix + 70),
    expected: expected.slice(Math.max(0, first - 70), expected.length - suffix + 70),
  };
}

/** Classify a round's visible differences, keeping execution failures separate. These are not semantic scores. */
export function differenceKind(round) {
  if (round.passed) return "pass";
  if ([round.missing, round.unexpected, round.invalid].some((a) => a?.length)) return "file-set";
  if (!round.changes.length) return "execution-only";
  if (round.changes.every((d) => d.onlyEof)) return "eof";
  if (round.changes.every((d) => d.onlyLineBreaks)) return "line-breaks";
  if (round.changes.every((d) => d.onlyAsciiLayout)) return "ascii-layout";
  return "other-text";
}

/** Keep native arguments when available; Codex file_change records do not contain patch requests. */
export function actionEvidence(event, index) {
  const name = event.toolName ?? event.data?.toolName ?? event.part?.tool ?? event.item?.type;
  const args =
    event.args ??
    event.data?.arguments ??
    event.part?.state?.input ??
    (name === "file_change"
      ? { changes: event.item.changes, status: event.item.status, patchUnavailable: true }
      : { command: event.item?.command });
  return { index: index + 1, name, args };
}

/** Summarize initial and terminal differences, not per-round failures as independent trials. */
export function summarizeFailures(cases) {
  const profiles = {};
  for (const c of cases) {
    const p = (profiles[c.profile] ??= {
      chains: 0,
      recovered: 0,
      exhausted: 0,
      rounds: 0,
      timedOutRounds: 0,
      initial: {},
      terminal: {},
      layoutToOtherText: [],
    });
    p.chains++;
    p[c.passed ? "recovered" : "exhausted"]++;
    p.rounds += c.rounds.length;
    p.timedOutRounds += c.rounds.filter((r) => r.timedOut).length;
    if (!c.rounds.length) {
      p.initial.infrastructure = (p.initial.infrastructure ?? 0) + 1;
      p.terminal.infrastructure = (p.terminal.infrastructure ?? 0) + 1;
      continue;
    }
    const initial = differenceKind(c.rounds[0]);
    const terminal = differenceKind(c.rounds.at(-1));
    p.initial[initial] = (p.initial[initial] ?? 0) + 1;
    p.terminal[terminal] = (p.terminal[terminal] ?? 0) + 1;
    if (
      ["eof", "line-breaks", "ascii-layout"].includes(initial) &&
      c.rounds.slice(1).some((r) => differenceKind(r) === "other-text")
    )
      p.layoutToOtherText.push(c.id);
  }
  return profiles;
}
