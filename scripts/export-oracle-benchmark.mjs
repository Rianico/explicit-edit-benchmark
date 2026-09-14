#!/usr/bin/env node
// Export only allowlisted benchmark fields. Raw agent payloads stay private.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { explicitEditTasks } from "../src/suites/explicit-edit/fixtures.ts";
import { compareText, differenceKind } from "./oracle-failure-evidence.mjs";
if (!process.argv[2])
  throw Error("Usage: node --import tsx scripts/export-oracle-benchmark.mjs RUN");
const root = path.resolve(process.argv[2]);
const source = await readFile(path.join(root, "summary.json"), "utf8");
const summary = JSON.parse(source);
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const tasks = new Map(explicitEditTasks().map((t) => [t.id, t]));
const rows = [];
for (const result of summary.results) {
  const task = tasks.get(result.taskId);
  if (!task || task.fixtureSha256 !== result.fixtureSha256) throw Error("Fixture drift");
  const rounds = [];
  for (const attempt of result.recovery?.attempts ?? []) {
    const changes = [];
    for (const file of attempt.comparison.differingFiles) {
      const actual = await readFile(
        path.join(root, "trials", result.id, "rounds", String(attempt.attempt), "workspace", file),
        "utf8",
      );
      changes.push(compareText(actual, task.expected[file]));
    }
    const kind = differenceKind({
      passed: attempt.passed,
      changes,
      missing: attempt.comparison.missingFiles,
      unexpected: attempt.comparison.unexpectedFiles,
      invalid: attempt.comparison.invalidEntries,
    });
    rounds.push({
      round: attempt.attempt,
      passed: attempt.passed,
      difference: kind,
      timedOut: attempt.execution.timedOut,
      exitCode: attempt.execution.exitCode,
      seconds: attempt.execution.processSeconds,
      toolCalls: attempt.execution.toolCalls ?? null,
    });
  }
  rows.push({
    id: result.id,
    task: result.taskId,
    profile: result.profile,
    fixtureSha256: result.fixtureSha256,
    rounds,
    infrastructureFailure:
      rounds.length === 0
        ? String(result.error ?? "Oracle chain produced no recorded rounds").split("\n")[0]
        : null,
  });
}
const profiles = Object.keys(manifest.harnesses).map((profile) => {
  const selected = rows.filter((r) => r.profile === profile);
  const eofPass = (r) => r.passed || (r.difference === "eof" && !r.timedOut && r.exitCode === 0);
  return {
    profile,
    tasks: selected.length,
    firstPassed: selected.filter((r) => r.rounds[0]?.passed).length,
    eventualPassed: selected.filter((r) => r.rounds.at(-1)?.passed).length,
    firstEofNormalized: selected.filter((r) => r.rounds[0] && eofPass(r.rounds[0])).length,
    terminalEofNormalized: selected.filter((r) => r.rounds.at(-1) && eofPass(r.rounds.at(-1)))
      .length,
    recoveries: selected.reduce((n, r) => n + Math.max(0, r.rounds.length - 1), 0),
    roundSeconds: selected.reduce((n, r) => n + r.rounds.reduce((n, a) => n + a.seconds, 0), 0),
    timeouts: selected.reduce((n, r) => n + r.rounds.filter((a) => a.timedOut).length, 0),
    infrastructureFailures: selected.filter((r) => r.infrastructureFailure).length,
  };
});
const output = path.join(root, "public");
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "benchmark.json"),
  JSON.stringify(
    {
      run: path.basename(root),
      summarySha256: createHash("sha256").update(source).digest("hex"),
      verifierSha256: manifest.verifierSha256 ?? null,
      configuration: {
        concurrency: manifest.concurrency,
        oracleRecoveries: manifest.oracleRecoveries,
        timeoutMs: manifest.timeoutMs,
        contract: manifest.contract,
      },
      versions: Object.fromEntries(
        Object.entries(manifest.harnesses).map(([name, a]) => [
          name,
          {
            version: a.version,
            model: a.model,
            thinking: a.thinking,
            sourceCommit: a.sourceCommit,
          },
        ]),
      ),
      profiles,
      trials: rows,
    },
    null,
    2,
  ),
);
const fields = Object.keys(profiles[0]);
await writeFile(
  path.join(output, "scores.csv"),
  fields.join(",") +
    "\n" +
    profiles.map((r) => fields.map((f) => r[f]).join(",")).join("\n") +
    "\n",
);
await writeFile(
  path.join(output, "failure-index.md"),
  "# Initially failed chains\n\nDifference categories describe files, not semantic correctness. R0 is the initial round.\n\n| Profile | Task | Round outcomes |\n|---|---|---|\n" +
    rows
      .filter((r) => !r.rounds[0]?.passed)
      .map((r) => {
        const outcomes = r.infrastructureFailure
          ? `Infrastructure failure: ${r.infrastructureFailure}`
          : r.rounds
              .map((a) => `R${a.round}: ${a.difference}${a.timedOut ? " (timeout)" : ""}`)
              .join("; ");
        return `| ${r.profile} | ${r.task} | ${outcomes} |`;
      })
      .join("\n") +
    "\n",
);
console.log(JSON.stringify(profiles, null, 2));
