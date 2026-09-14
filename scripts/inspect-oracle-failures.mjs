#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { compareText, actionEvidence, summarizeFailures } from "./oracle-failure-evidence.mjs";
import { explicitEditTasks } from "../src/suites/explicit-edit/fixtures.ts";

// Offline evidence extraction. Recorded outcomes and workspaces are never changed.
if (!process.argv[2])
  throw Error("Usage: node --import tsx scripts/inspect-oracle-failures.mjs RUN_DIRECTORY");
const root = path.resolve(process.argv[2]);
const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
const tasks = new Map(explicitEditTasks().map((t) => [t.id, t]));
const output = path.join(root, "failure-review");
await mkdir(output, { recursive: true });
const clip = (text, limit = 1800) =>
  text.length > limit ? `${text.slice(0, limit)} [truncated; see raw artifact]` : text;
const cases = [];
for (const row of summary.results) {
  if (row.profile === "ide" || row.recovery?.firstAttemptPassed) continue;
  const task = tasks.get(row.taskId);
  if (!task || task.fixtureSha256 !== row.fixtureSha256) throw Error("Fixture drift");
  const rounds = [];
  for (const attempt of row.recovery?.attempts ?? []) {
    const dir = path.join(root, "trials", row.id, "rounds", String(attempt.attempt));
    const changes = [];
    for (const file of attempt.comparison.differingFiles ?? []) {
      const actual = await readFile(path.join(dir, "workspace", file), "utf8");
      const expected = task.expected[file];
      const difference = compareText(actual, expected);
      changes.push({
        file,
        ...difference,
        actual: clip(difference.actual, 700),
        expected: clip(difference.expected, 700),
      });
    }
    let malformedEventLines = 0;
    const events = (await readFile(path.join(dir, "agent/stdout.jsonl"), "utf8"))
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          return [JSON.parse(line)];
        } catch {
          malformedEventLines++;
          return [];
        }
      });
    const calls = JSON.parse(await readFile(path.join(dir, "tool-calls.json"), "utf8")) ?? [];
    const actions = calls.map((e, index) => {
      const action = actionEvidence(e, index);
      return { ...action, args: clip(JSON.stringify(action.args), 2200) };
    });
    const errors = events
      .filter(
        (e) =>
          e.isError ||
          e.type === "error" ||
          e.type === "turn.failed" ||
          e.type === "session.error" ||
          e.part?.state?.status === "error" ||
          e.data?.success === false ||
          (e.item?.exit_code != null && e.item.exit_code !== 0),
      )
      .map((e) => clip(JSON.stringify(e), 1200));
    const final = events
      .filter(
        (e) =>
          (e.type === "message_end" && e.message?.role === "assistant") ||
          (e.type === "item.completed" && e.item?.type === "agent_message") ||
          e.type === "text" ||
          e.type === "assistant.message",
      )
      .map((e) =>
        clip(
          JSON.stringify(
            e.message?.content?.filter((c) => c.type === "text") ??
              e.item?.text ??
              e.part?.text ??
              e.data?.content ??
              e.text ??
              "",
          ),
          700,
        ),
      )
      .filter((t) => t !== "[]" && t !== '""');
    rounds.push({
      malformedEventLines,
      number: attempt.attempt,
      passed: attempt.passed,
      timedOut: attempt.execution.timedOut,
      seconds: attempt.execution.processSeconds,
      changes,
      missing: attempt.comparison.missingFiles,
      unexpected: attempt.comparison.unexpectedFiles,
      invalid: attempt.comparison.invalidEntries,
      actions,
      errors,
      final,
      artifact: path.relative(root, dir),
    });
  }
  cases.push({ id: row.id, task: row.taskId, profile: row.profile, passed: row.passed, rounds });
}
await writeFile(path.join(output, "cases.json"), JSON.stringify(cases, null, 2));
await writeFile(
  path.join(output, "summary.json"),
  JSON.stringify(summarizeFailures(cases), null, 2),
);
for (const c of cases) {
  const lines = [`# ${c.id}: ${c.passed ? "recovered" : "exhausted"}`];
  for (const r of c.rounds) {
    lines.push(
      `\n## Round ${r.number}: ${r.passed ? "PASS" : "FAIL"} ${r.seconds.toFixed(2)}s timeout=${r.timedOut}`,
      `Artifact: ${r.artifact}`,
      `Changes: ${JSON.stringify(r.changes)}`,
      `Missing/extra/invalid: ${JSON.stringify([r.missing, r.unexpected, r.invalid])}`,
    );
    for (const a of r.actions) lines.push(`${a.index}. ${a.name}: ${a.args}`);
    for (const error of r.errors) lines.push(`ERROR: ${error}`);
    for (const text of r.final) lines.push(`AGENT: ${text}`);
  }
  await writeFile(path.join(output, `${c.id}.md`), lines.join("\n") + "\n");
}
console.log(
  `Extracted ${cases.length} chains, ${cases.reduce((n, c) => n + c.rounds.length, 0)} rounds to ${output}`,
);
