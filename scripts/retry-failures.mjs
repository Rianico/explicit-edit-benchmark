/** Parse the number of additional attempts allowed after a failed trial. */
export function retryBudget(value, attempts = 1) {
  const budget = Number(value);
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw Error("Invalid retry-failures: expected a non-negative integer");
  if (budget > 0 && attempts !== 1) throw Error("Choose --attempts or --retry-failures, not both");
  return budget;
}

/** Queue a fresh attempt only after failure; the original trial remains unchanged. */
export function nextRetry(trial, result, budget) {
  const attempt = trial.attempt ?? 1;
  if (result.passed === true || attempt > budget) return null;
  return {
    ...trial,
    attempt: attempt + 1,
    id: `${trial.taskId}__r${String(attempt + 1).padStart(2, "0")}__${trial.profile}`,
  };
}

/** Report first-attempt and budgeted outcomes separately, retaining all trial results. */
export function retrySummary(results, budget) {
  const groups = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.taskId, result.profile]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  const chains = [...groups.values()].map((rows) => {
    rows.sort((a, b) => a.attempt - b.attempt);
    const success = rows.find((row) => row.passed === true);
    return {
      taskId: rows[0].taskId,
      profile: rows[0].profile,
      firstAttemptPassed: rows[0].passed === true,
      passed: Boolean(success),
      successfulAttempt: success?.attempt ?? null,
      attempts: rows.length,
      exhausted: !success && rows.length === budget + 1,
      totalSeconds: rows.every((row) => Number.isFinite(row.seconds))
        ? rows.reduce((sum, row) => sum + row.seconds, 0)
        : null,
    };
  });
  return {
    additionalAttempts: budget,
    criterion: "passed (exact verifier and successful execution)",
    note: "Success within a retry budget is not single-attempt reliability.",
    firstAttemptPassed: chains.filter((row) => row.firstAttemptPassed).length,
    eventuallyPassed: chains.filter((row) => row.passed).length,
    chains,
  };
}
