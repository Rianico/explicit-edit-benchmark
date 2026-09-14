#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const MODEL_PROFILE_PREFIXES = new Map([
  ["GLM 5.3 Flash", "glm-5-3-flash"],
  ["DeepSeek V4 Flash", "deepseek-v4-flash"],
  ["DeepSeek V4.1 Flash preview", "deepseek-next-flash"],
  ["MiMo 2.5", "mimo-v2-5"],
  ["GPT-5.6 Luna Low", ""],
]);
const MODEL_FILES = new Map([
  ["GLM 5.3 Flash", "glm-5-3-flash"],
  ["DeepSeek V4 Flash", "deepseek-v4-flash"],
  ["DeepSeek V4.1 Flash preview", "deepseek-v4-1-flash"],
  ["MiMo 2.5", "mimo-v2-5"],
  ["GPT-5.6 Luna Low", "gpt-5-6-luna-low"],
]);
const HARNESS_SUFFIXES = new Map([
  ["Vanilla Pi", "vanilla"],
  ["Pi Agent IDE", "ide"],
  ["OpenCode", "opencode"],
  ["OMP", "omp"],
  ["Copilot CLI", "copilot"],
  ["Codex CLI", "codex"],
  ["DeepSeek Harness Standard", "dsh-standard"],
  ["DeepSeek Harness Code", "dsh-code"],
]);
const HARNESS_FILES = new Map([
  ["Vanilla Pi", "vanilla-pi"],
  ["Pi Agent IDE", "pi-agent-ide"],
  ["OpenCode", "opencode"],
  ["OMP", "omp"],
  ["Copilot CLI", "copilot-cli"],
  ["Codex CLI", "codex-cli"],
  ["DeepSeek Harness Standard", "deepseek-harness-standard"],
  ["DeepSeek Harness Code", "deepseek-harness-code"],
]);
const MUTATION_TOOLS = new Set([
  "apply_patch",
  "copy",
  "create",
  "delete",
  "edit",
  "file_change",
  "insert",
  "move",
  "replace",
  "str_replace_editor",
  "undo",
  "write",
]);
const READ_TOOLS = new Set(["read", "view"]);
const SEARCH_TOOLS = new Set(["glob", "grep", "rg", "search"]);
const SHELL_FUNCTIONS = [
  ["search", /(^|[;&|()\s])(rg|grep|find)(\s|$)/],
  ["line or file read", /(^|[;&|()\s])(cat|head|tail|sed|awk|wc)(\s|$)/],
  ["byte or EOF check", /(^|[;&|()\s])(xxd|od|file)(\s|$)/],
  ["checksum", /(^|[;&|()\s])(sha\w*sum|md5sum)(\s|$)/],
  ["diff or compare", /(^|[;&|()\s])(diff|cmp)(\s|$)/],
  ["file listing", /(^|[;&|()\s])ls(\s|$)/],
  ["file operation", /(^|[;&|()\s])(cp|mv|rm|touch|mkdir)(\s|$)/],
  ["script", /(^|[;&|()\s])(python\d*|node|perl|ruby)(\s|$)/],
  ["test or build", /(^|[;&|()\s])(npm|pnpm|yarn|bun|pytest|vitest|tsc)(\s|$)/],
];

const pct = (part, total) => (total ? (100 * part) / total : 0);
const fixed = (value, digits = 1) => Number(value).toFixed(digits);
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (rows, fields) =>
  `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")).join("\n")}\n`;
const add = (map, key, amount = 1) => map.set(key, (map.get(key) ?? 0) + amount);

function sourceProfile(row) {
  const prefix = MODEL_PROFILE_PREFIXES.get(row.model);
  let suffix = HARNESS_SUFFIXES.get(row.harness);
  if (prefix === undefined || suffix === undefined)
    throw Error(`Unknown route ${row.model}/${row.harness}`);
  if (row.model === "GPT-5.6 Luna Low" && row.harness === "Copilot CLI") suffix = "copilot-vekil";
  return prefix ? `${prefix}-${suffix}` : suffix;
}

async function readResults(file) {
  const [header, ...lines] = (await readFile(file, "utf8")).trim().split("\n");
  const fields = header.split(",");
  return lines.map((line) =>
    Object.fromEntries(line.split(",").map((value, index) => [fields[index], value])),
  );
}

export function callData(call) {
  if (call.type === "item.completed") {
    if (call.item.type === "command_execution") {
      return {
        id: call.item.id,
        name: "command_execution",
        nativeName: "command_execution",
        args: { command: call.item.command },
        error: call.item.exit_code == null ? null : call.item.exit_code !== 0,
      };
    }
    return {
      id: call.item.id,
      name: call.item.type,
      nativeName: call.item.type,
      args: call.item,
      error: call.item.status == null ? null : call.item.status !== "completed",
    };
  }
  if (call.type === "tool_use") {
    return {
      id: call.part.callID,
      name: call.part.tool,
      nativeName: call.part.tool,
      args: call.part.state?.input ?? {},
      error: call.part.state?.status == null ? null : call.part.state.status === "error",
    };
  }
  if (call.type === "tool.execution_start") {
    return {
      id: call.data.toolCallId,
      name: call.data.toolName,
      nativeName: call.data.toolName,
      args: call.data.arguments ?? {},
      error: null,
    };
  }
  if (call.type === "tool/call") {
    let args = call.data.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    return {
      id: call.data.callId,
      name: call.data.name,
      nativeName: call.data.name,
      args,
      error: null,
    };
  }
  return {
    id: call.toolCallId,
    name: call.toolName ?? "unknown",
    nativeName: call.toolName ?? "unknown",
    args: call.args ?? {},
    error: null,
  };
}

export function toolCategory(name) {
  if (["bash", "command_execution", "read_bash"].includes(name)) return "command";
  if (MUTATION_TOOLS.has(name)) return "mutation";
  if (READ_TOOLS.has(name)) return "read";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (name === "eval") return "native code";
  if (
    [
      "exit_plan_mode",
      "report_intent",
      "task",
      "todo",
      "todo_write",
      "todowrite",
      "update_goal",
    ].includes(name)
  )
    return "planning/control";
  return "other";
}

export function likelyShellMutation(command, args = {}) {
  if (args.shellToolInfo?.hasWriteFileRedirection) return true;
  const redirections = [...command.matchAll(/(?:^|[^<])>{1,2}\s*["']?([^\s;|"']+)/g)];
  if (redirections.some((match) => !match[1].startsWith("/tmp/") && !match[1].startsWith("/dev/")))
    return true;
  if (!/\b(sed|perl)\s+[^;&|]*-i\b|\btee\b|(^|[;&|]\s*)(cp|mv|rm|touch|mkdir)\b/.test(command))
    return false;
  return command.includes("/workspace/") || !command.includes("/tmp/");
}

function shellFunctions(command, args) {
  const labels = SHELL_FUNCTIONS.filter(([, expression]) => expression.test(command)).map(
    ([label]) => label,
  );
  if (likelyShellMutation(command, args)) labels.push("likely workspace write");
  return labels.length ? [...new Set(labels)] : ["other shell work"];
}

function createGroup(key, model = "", harness = "") {
  return {
    key,
    model,
    harness,
    tasks: new Set(),
    chains: new Set(),
    rounds: 0,
    scoredRounds: 0,
    passedRounds: 0,
    timedOutRounds: 0,
    calls: 0,
    knownOutcomes: 0,
    toolErrors: 0,
    tools: new Map(),
    toolOutcomes: new Map(),
    toolErrorsByName: new Map(),
    categories: new Map(),
    shellFunctions: new Map(),
    patterns: new Map(),
    shellMutationRounds: 0,
    nativeMutationRounds: 0,
    mixedMutationRounds: 0,
    noMutationRounds: 0,
  };
}

function addRound(group, record) {
  group.tasks.add(record.task);
  group.chains.add(record.chain);
  group.rounds++;
  group.scoredRounds += record.passed == null ? 0 : 1;
  group.passedRounds += record.passed ? 1 : 0;
  group.timedOutRounds += record.timedOut ? 1 : 0;
  group.calls += record.calls.length;
  const pattern = record.calls.length
    ? record.calls.map((call) => call.name).join(" → ")
    : "no recorded tools";
  add(group.patterns, pattern);
  let nativeMutation = false;
  let shellMutation = false;
  for (const call of record.calls) {
    add(group.tools, call.name);
    add(group.categories, call.category);
    if (call.error != null) {
      group.knownOutcomes++;
      add(group.toolOutcomes, call.name);
      group.toolErrors += call.error ? 1 : 0;
      if (call.error) add(group.toolErrorsByName, call.name);
    }
    if (call.category === "mutation") nativeMutation = true;
    if (["bash", "command_execution"].includes(call.name)) {
      const command = String(call.args.command ?? "");
      const functions = shellFunctions(command, call.args);
      for (const label of functions) add(group.shellFunctions, label);
      if (functions.includes("likely workspace write")) shellMutation = true;
    }
  }
  if (nativeMutation && shellMutation) group.mixedMutationRounds++;
  else if (nativeMutation) group.nativeMutationRounds++;
  else if (shellMutation) group.shellMutationRounds++;
  else group.noMutationRounds++;
}

function summaryRow(group, scope, name) {
  return {
    scope,
    name,
    model: group.model,
    harness: group.harness,
    tasks: group.tasks.size,
    chains: group.chains.size,
    rounds: group.rounds,
    tool_calls: group.calls,
    calls_per_round: group.rounds ? group.calls / group.rounds : 0,
    scored_rounds: group.scoredRounds,
    passed_rounds: group.passedRounds,
    timed_out_rounds: group.timedOutRounds,
    known_tool_outcomes: group.knownOutcomes,
    tool_errors: group.toolErrors,
    shell_mutation_rounds: group.shellMutationRounds,
    native_mutation_rounds: group.nativeMutationRounds,
    mixed_mutation_rounds: group.mixedMutationRounds,
    no_observed_mutation_rounds: group.noMutationRounds,
  };
}

function renderBarChart(group, title, file) {
  const categories = [
    "command",
    "mutation",
    "read",
    "search",
    "native code",
    "planning/control",
    "other",
  ];
  const colors = ["#e07a3f", "#4f7cff", "#36a269", "#8b6edb", "#d2a72c", "#8792a5", "#b8c0cc"];
  const total = group.calls || 1;
  const width = 1100;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="230" viewBox="0 0 ${width} 230" role="img">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<text x="40" y="38" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#172033">${title}</text>`,
  ];
  let x = 40;
  categories.forEach((category, index) => {
    const count = group.categories.get(category) ?? 0;
    const segment = (1020 * count) / total;
    if (segment)
      svg.push(`<rect x="${x}" y="68" width="${segment}" height="46" fill="${colors[index]}"/>`);
    x += segment;
  });
  categories.forEach((category, index) => {
    const count = group.categories.get(category) ?? 0;
    const lx = 40 + (index % 4) * 260;
    const ly = 154 + Math.floor(index / 4) * 34;
    svg.push(
      `<rect x="${lx}" y="${ly - 14}" width="18" height="18" fill="${colors[index]}"/>`,
      `<text x="${lx + 28}" y="${ly}" font-family="system-ui, sans-serif" font-size="14" fill="#263248">${category}: ${count} (${fixed(pct(count, group.calls))}%)</text>`,
    );
  });
  svg.push("</svg>");
  return writeFile(file, `${svg.join("\n")}\n`);
}

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function groupMarkdown(group, title, backLink, chart, profileLinks = []) {
  const tools = sortedEntries(group.tools);
  const functions = sortedEntries(group.shellFunctions);
  const patterns = sortedEntries(group.patterns).slice(0, 10);
  const knownCoverage = pct(group.knownOutcomes, group.calls);
  return [
    `# ${title}`,
    "",
    backLink,
    "",
    `Across ${group.chains.size} task chains (${group.tasks.size} unique task IDs) and ${group.rounds} rounds, agents made ${group.calls} recorded tool calls (${fixed(group.calls / group.rounds)} per round). ${group.scoredRounds} rounds have verifier results: ${group.passedRounds} passed and ${group.timedOutRounds} timed out. Retained artifacts expose outcomes for ${group.knownOutcomes} calls (${fixed(knownCoverage)}%); ${group.toolErrors} of those are explicit errors.`,
    "",
    `![Tool category mix](${chart})`,
    "",
    "## Tools",
    "",
    "| Tool | Calls | Share | Known outcomes | Explicit errors |",
    "|---|---:|---:|---:|---:|",
    ...tools.map(
      ([name, count]) =>
        `| ${name} | ${count} | ${fixed(pct(count, group.calls))}% | ${group.toolOutcomes.get(name) ?? 0} | ${group.toolErrorsByName.get(name) ?? 0} |`,
    ),
    "",
    "## How edits were made",
    "",
    `- Native editor only: ${group.nativeMutationRounds} rounds (${fixed(pct(group.nativeMutationRounds, group.rounds))}%).`,
    `- Likely shell write only: ${group.shellMutationRounds} rounds (${fixed(pct(group.shellMutationRounds, group.rounds))}%).`,
    `- Both: ${group.mixedMutationRounds} rounds (${fixed(pct(group.mixedMutationRounds, group.rounds))}%).`,
    `- No observed mutation: ${group.noMutationRounds} rounds (${fixed(pct(group.noMutationRounds, group.rounds))}%).`,
    "",
    'A likely shell write is detected from redirection or common file-changing commands. This is a useful estimate, not a full shell parser. Native-code tools such as OMP `eval` can also write files, so "no observed mutation" does not mean that no edit happened.',
    "",
    "## Command work",
    "",
    ...(functions.length
      ? functions.map(([name, count]) => `- **${name}:** ${count} command calls.`)
      : ["No shell command calls were recorded."]),
    "",
    "## Most common recorded tool sequences",
    "",
    ...patterns.map(([name, count]) => `- **${count} rounds:** ${name}.`),
    "",
    ...profileLinks,
    "## Limits",
    "",
    "Tool names and arguments come from retained harness events. Native tools differ between harnesses, so names are preserved and also grouped into broad categories. Only OpenCode and Codex retained per-call outcomes in these runs; explicit error counts must not be compared as if all harnesses had equal coverage. A recorded call does not prove that the call caused the final workspace change.",
    "",
  ].join("\n");
}

function comparisonTable(groups, link) {
  return [
    "| View | Chains | Calls/round | Command calls | Native editor rounds | Likely shell-write rounds |",
    "|---|---:|---:|---:|---:|---:|",
    ...[...groups].map(([name, group]) => {
      const nativeRounds = group.nativeMutationRounds + group.mixedMutationRounds;
      const shellRounds = group.shellMutationRounds + group.mixedMutationRounds;
      return `| [${name}](${link(name)}) | ${group.chains.size} | ${fixed(group.calls / group.rounds)} | ${fixed(pct(group.categories.get("command") ?? 0, group.calls))}% | ${fixed(pct(nativeRounds, group.rounds))}% | ${fixed(pct(shellRounds, group.rounds))}% |`;
    }),
    "",
  ];
}

async function main() {
  const [resultsFile, outputDirectory, ...roots] = process.argv.slice(2);
  if (!resultsFile || !outputDirectory || !roots.length)
    throw Error(
      "Usage: build-trajectory-analysis.mjs RESULTS.csv OUTPUT_DIRECTORY RUN_DIRECTORY [...]",
    );
  const results = await readResults(resultsFile);
  const profileRows = new Map(results.map((row) => [sourceProfile(row), row]));
  const profileGroups = new Map();
  const modelGroups = new Map();
  const harnessGroups = new Map();
  const overall = createGroup("overall");
  for (const row of results) {
    profileGroups.set(sourceProfile(row), createGroup(sourceProfile(row), row.model, row.harness));
    if (!modelGroups.has(row.model))
      modelGroups.set(row.model, createGroup(row.model, row.model, ""));
    if (!harnessGroups.has(row.harness))
      harnessGroups.set(row.harness, createGroup(row.harness, "", row.harness));
  }

  for (const root of roots) {
    const trialNames = await readdir(path.join(root, "trials"));
    for (const trialName of trialNames) {
      const profile = trialName.split("__r01__")[1];
      const row = profileRows.get(profile);
      if (!row) continue;
      const task = trialName.split("__r01__")[0];
      const roundsDirectory = path.join(root, "trials", trialName, "rounds");
      let roundNames;
      try {
        roundNames = await readdir(roundsDirectory);
      } catch {
        continue;
      }
      for (const roundName of roundNames.sort((a, b) => Number(a) - Number(b))) {
        const roundDirectory = path.join(roundsDirectory, roundName);
        let rawCalls;
        try {
          rawCalls = JSON.parse(
            await readFile(path.join(roundDirectory, "tool-calls.json"), "utf8"),
          );
        } catch (error) {
          throw Error(`Could not read tool calls in ${roundDirectory}: ${error.message}`, {
            cause: error,
          });
        }
        let roundResult = null;
        try {
          roundResult = JSON.parse(
            await readFile(path.join(roundDirectory, "result.json"), "utf8"),
          );
        } catch {
          // Some infrastructure failures retain the agent trace without a scored round result.
        }
        const calls = rawCalls.map((raw) => {
          const call = callData(raw);
          call.category = toolCategory(call.name);
          return call;
        });
        const record = {
          task,
          chain: `${row.model}\0${row.harness}\0${task}`,
          passed: roundResult == null ? null : Boolean(roundResult.passed),
          timedOut: Boolean(roundResult?.execution?.timedOut),
          calls,
        };
        addRound(profileGroups.get(profile), record);
        addRound(modelGroups.get(row.model), record);
        addRound(harnessGroups.get(row.harness), record);
        addRound(overall, record);
      }
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  await mkdir(path.join(outputDirectory, "models", "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "harnesses", "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "profiles", "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "data"), { recursive: true });
  const groups = [
    ["overall", "all", overall],
    ...[...modelGroups].map(([name, group]) => ["model", name, group]),
    ...[...harnessGroups].map(([name, group]) => ["harness", name, group]),
    ...[...profileGroups].map(([name, group]) => ["profile", name, group]),
  ];
  const summary = groups.map(([scope, name, group]) => summaryRow(group, scope, name));
  const usage = groups.flatMap(([scope, name, group]) =>
    sortedEntries(group.tools).map(([tool, calls]) => ({
      scope,
      name,
      model: group.model,
      harness: group.harness,
      tool,
      calls,
      share: pct(calls, group.calls),
      known_outcomes: group.toolOutcomes.get(tool) ?? 0,
      explicit_errors: group.toolErrorsByName.get(tool) ?? 0,
    })),
  );
  const bashUsage = groups.flatMap(([scope, name, group]) =>
    sortedEntries(group.shellFunctions).map(([functionName, calls]) => ({
      scope,
      name,
      model: group.model,
      harness: group.harness,
      function: functionName,
      calls,
    })),
  );
  const patterns = groups.flatMap(([scope, name, group]) =>
    sortedEntries(group.patterns).map(([pattern, rounds]) => ({
      scope,
      name,
      model: group.model,
      harness: group.harness,
      pattern,
      rounds,
      share: pct(rounds, group.rounds),
    })),
  );
  await Promise.all([
    writeFile(
      path.join(outputDirectory, "data", "summary.csv"),
      csv(summary, Object.keys(summary[0])),
    ),
    writeFile(
      path.join(outputDirectory, "data", "tool-usage.csv"),
      csv(usage, Object.keys(usage[0])),
    ),
    writeFile(
      path.join(outputDirectory, "data", "bash-usage.csv"),
      csv(bashUsage, Object.keys(bashUsage[0])),
    ),
    writeFile(
      path.join(outputDirectory, "data", "patterns.csv"),
      csv(patterns, Object.keys(patterns[0])),
    ),
  ]);

  const writes = [];
  for (const group of profileGroups.values()) {
    const profileSlug = `${MODEL_FILES.get(group.model)}--${HARNESS_FILES.get(group.harness)}`;
    writes.push(
      writeFile(
        path.join(outputDirectory, "profiles", `${profileSlug}.md`),
        groupMarkdown(
          group,
          `${group.model} in ${group.harness}: tool use`,
          "[Trajectory index](../README.md) · [Model view](../models/" +
            MODEL_FILES.get(group.model) +
            ".md) · [Harness view](../harnesses/" +
            HARNESS_FILES.get(group.harness) +
            ".md)",
          `assets/${profileSlug}-tool-mix.svg`,
        ),
      ),
      renderBarChart(
        group,
        `${group.model} in ${group.harness}: tool mix`,
        path.join(outputDirectory, "profiles", "assets", `${profileSlug}-tool-mix.svg`),
      ),
    );
  }
  for (const [model, group] of modelGroups) {
    const links = [
      "## Model-harness profiles",
      "",
      ...results
        .filter((row) => row.model === model)
        .map(
          (row) =>
            `- [${row.harness}](../profiles/${MODEL_FILES.get(model)}--${HARNESS_FILES.get(row.harness)}.md)`,
        ),
      "",
    ];
    writes.push(
      writeFile(
        path.join(outputDirectory, "models", `${MODEL_FILES.get(model)}.md`),
        groupMarkdown(
          group,
          `${model}: tool use across harnesses`,
          "[Trajectory index](../README.md) · [Baseline model scores](../../models/" +
            MODEL_FILES.get(model) +
            ".md)",
          `assets/${MODEL_FILES.get(model)}-tool-mix.svg`,
          links,
        ),
      ),
      renderBarChart(
        group,
        `${model}: tool mix`,
        path.join(outputDirectory, "models", "assets", `${MODEL_FILES.get(model)}-tool-mix.svg`),
      ),
    );
  }
  for (const [harness, group] of harnessGroups) {
    const links = [
      "## Model-harness profiles",
      "",
      ...results
        .filter((row) => row.harness === harness)
        .map(
          (row) =>
            `- [${row.model}](../profiles/${MODEL_FILES.get(row.model)}--${HARNESS_FILES.get(harness)}.md)`,
        ),
      "",
    ];
    writes.push(
      writeFile(
        path.join(outputDirectory, "harnesses", `${HARNESS_FILES.get(harness)}.md`),
        groupMarkdown(
          group,
          `${harness}: tool use across models`,
          "[Trajectory index](../README.md) · [Baseline harness scores](../../harnesses/" +
            HARNESS_FILES.get(harness) +
            ".md)",
          `assets/${HARNESS_FILES.get(harness)}-tool-mix.svg`,
          links,
        ),
      ),
      renderBarChart(
        group,
        `${harness}: tool mix`,
        path.join(
          outputDirectory,
          "harnesses",
          "assets",
          `${HARNESS_FILES.get(harness)}-tool-mix.svg`,
        ),
      ),
    );
  }
  const overview = groupMarkdown(
    overall,
    "Tool use and trajectories",
    "[Back to the baseline index](../README.md)",
    "assets/tool-mix.svg",
    [
      "## What stands out",
      "",
      "- In Pi Agent IDE, a native editor call appeared in 884 of 1,377 rounds (64.2%). A likely shell write appeared in 381 rounds (27.7%). The groups overlap in 70 rounds.",
      "- Luna used native editing most strongly: 76.3% of its rounds across harnesses had a native mutation, while only 6.6% had a likely shell write.",
      "- The four Chinese models used likely shell writes in 25.9% to 37.7% of rounds. Their exact tool mix still changed substantially by harness.",
      "- Codex records almost all executable work as `command_execution`, so its 91.1% command share is partly a harness event-schema effect. Do not read it as a clean behavioral preference against editor tools.",
      "",
      "## Pi Agent IDE: native tools versus shell writes",
      "",
      "A round can appear in both columns. The denominator includes first attempts and recovery rounds.",
      "",
      "| Model | Rounds | Native editor | Likely shell write | Both |",
      "|---|---:|---:|---:|---:|",
      ...[...profileGroups.values()]
        .filter((group) => group.harness === "Pi Agent IDE")
        .map((group) => {
          const native = group.nativeMutationRounds + group.mixedMutationRounds;
          const shell = group.shellMutationRounds + group.mixedMutationRounds;
          return `| [${group.model}](profiles/${MODEL_FILES.get(group.model)}--pi-agent-ide.md) | ${group.rounds} | ${native} (${fixed(pct(native, group.rounds))}%) | ${shell} (${fixed(pct(shell, group.rounds))}%) | ${group.mixedMutationRounds} (${fixed(pct(group.mixedMutationRounds, group.rounds))}%) |`;
        }),
      "",
      "## Compare models",
      "",
      "Each model covers eight harnesses. Percentages are shares of that model's recorded calls or rounds.",
      "",
      ...comparisonTable(modelGroups, (model) => `models/${MODEL_FILES.get(model)}.md`),
      "## Compare harnesses",
      "",
      "Each harness covers five models. A command call is Bash or Codex command execution. Native editor and likely shell-write rounds can overlap.",
      "",
      ...comparisonTable(harnessGroups, (harness) => `harnesses/${HARNESS_FILES.get(harness)}.md`),
      "Every model and harness page links to its five or eight exact model-harness profiles.",
      "",
    ],
  );
  writes.push(
    writeFile(path.join(outputDirectory, "README.md"), overview),
    renderBarChart(
      overall,
      "All baseline rounds: tool mix",
      path.join(outputDirectory, "assets", "tool-mix.svg"),
    ),
  );
  await Promise.all(writes);
  console.log(
    `Built trajectory analysis from ${overall.tasks.size} task IDs, ${overall.rounds} rounds and ${overall.calls} calls`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
