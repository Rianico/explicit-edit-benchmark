/** Select failures and unknown outcomes; a single shared pass never proves permanent safety. */
export function selectFocused(tasks, rows, profiles, criterion = "eofNormalizedPassed") {
  if (!["strictPassed", "eofNormalizedPassed"].includes(criterion))
    throw Error("Unknown criterion");
  if (!profiles.length || new Set(profiles).size !== profiles.length)
    throw Error("Invalid profiles");
  const indexed = new Map();
  for (const row of rows) {
    const key = `${row.taskId}/${row.profile}`;
    if (indexed.has(key)) throw Error(`Duplicate outcome ${key}`);
    indexed.set(key, row);
  }
  const included = [],
    excluded = [];
  for (const task of tasks) {
    const reasons = profiles.flatMap((profile) => {
      const row = indexed.get(`${task.id}/${profile}`);
      return row?.[criterion] === true && !row.timedOut
        ? []
        : [
            {
              profile,
              reason: row?.timedOut
                ? "timeout"
                : row?.[criterion] === false
                  ? "failed"
                  : "missing-or-unknown",
            },
          ];
    });
    const entry = { id: task.id, fixtureSha256: task.fixtureSha256, reasons };
    (reasons.length ? included : excluded).push(entry);
  }
  return { version: 1, criterion, profiles, included, excluded };
}

/** Validate a frozen selection against current fixtures before starting any agent. */
export function selectedTasks(tasks, selection) {
  if (selection.version !== 1 || !Array.isArray(selection.included))
    throw Error("Invalid selection manifest");
  const index = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set();
  return selection.included.map((entry) => {
    const task = index.get(entry.id);
    if (!task || task.fixtureSha256 !== entry.fixtureSha256 || seen.has(entry.id))
      throw Error(`Unknown, duplicate or changed task: ${entry.id}`);
    seen.add(entry.id);
    return task;
  });
}
