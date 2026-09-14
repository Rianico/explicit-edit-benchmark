#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAMILY_PREFIXES = [
  ["language-", "Language variants"],
  ["unicode-fix-", "Unicode repairs"],
  ["unique-", "Unique replacement"],
  ["replace-all-", "Replace all"],
  ["multi-file-", "Multiple files"],
  ["select-one-", "Select one"],
  ["select-subset-", "Select subset"],
  ["delete-subset-", "Delete subset"],
  ["insert-subset-", "Insert subset"],
  ["distinct-edits-", "Different edits"],
  ["literal-", "Literal text"],
  ["replace-block-", "Replace block"],
  ["delete-block-", "Delete block"],
  ["move-block-", "Move block"],
  ["copy-block-", "Copy block"],
  ["insert-block-", "Insert block"],
  ["insert-payload-", "Insert payload"],
  ["copy-within-", "Copy within file"],
  ["move-between-", "Move between files"],
];
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
const HARNESS_PROFILE_SUFFIXES = new Map([
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
const MODEL_SHORT_NAMES = new Map([
  ["GLM 5.3 Flash", "GLM 5.3"],
  ["DeepSeek V4 Flash", "DS V4"],
  ["DeepSeek V4.1 Flash preview", "DS V4.1"],
  ["MiMo 2.5", "MiMo 2.5"],
  ["GPT-5.6 Luna Low", "Luna Low"],
]);
const HARNESS_SHORT_NAMES = new Map([
  ["Vanilla Pi", "Vanilla"],
  ["Pi Agent IDE", "IDE"],
  ["OpenCode", "OpenCode"],
  ["OMP", "OMP"],
  ["Copilot CLI", "Copilot"],
  ["Codex CLI", "Codex"],
  ["DeepSeek Harness Standard", "DSH Std"],
  ["DeepSeek Harness Code", "DSH Code"],
]);

const escapeXml = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const percentage = (passed, tasks) => (100 * passed) / tasks;
const formatNumber = (value, digits = 1) => (value == null ? "" : Number(value).toFixed(digits));
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (rows, fields) =>
  `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")).join("\n")}\n`;

export function taskFamily(task) {
  const match = FAMILY_PREFIXES.find(([prefix]) => task.startsWith(prefix));
  if (!match) throw Error(`Unknown task family for ${task}`);
  return match[1];
}

export function quantile(sorted, position) {
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[lower + 1] - sorted[lower]) * fraction || sorted[lower];
}

export function boxStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const fence = 1.5 * (q3 - q1);
  const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence);
  return {
    q1,
    median,
    q3,
    low: inside[0],
    high: inside.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    outliers: sorted.filter((value) => value < q1 - fence || value > q3 + fence),
  };
}

export function averageRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
}

export function spearman(left, right) {
  if (left.length !== right.length || !left.length) throw Error("Spearman vectors must align");
  const a = averageRanks(left);
  const b = averageRanks(right);
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < a.length; index++) {
    const deltaA = a[index] - meanA;
    const deltaB = b[index] - meanB;
    numerator += deltaA * deltaB;
    squareA += deltaA * deltaA;
    squareB += deltaB * deltaB;
  }
  const denominator = Math.sqrt(squareA * squareB);
  return denominator ? numerator / denominator : null;
}

function sourceProfile(row) {
  const prefix = MODEL_PROFILE_PREFIXES.get(row.model);
  let suffix = HARNESS_PROFILE_SUFFIXES.get(row.harness);
  if (prefix === undefined || suffix === undefined)
    throw Error(`Unknown result route: ${row.model} / ${row.harness}`);
  if (row.model === "GPT-5.6 Luna Low" && row.harness === "Copilot CLI") suffix = "copilot-vekil";
  return prefix ? `${prefix}-${suffix}` : suffix;
}

function trialMeasures(trial) {
  const first = trial.rounds[0];
  if (!first) {
    return {
      firstExact: false,
      finalExact: false,
      firstEof: false,
      terminalEof: false,
      recoveries: 0,
      timeouts: 0,
      infrastructureFailures: 1,
    };
  }
  const firstExact = Boolean(first.passed);
  const terminal = trial.rounds.at(-1);
  const finalExact = Boolean(terminal.passed);
  const eofPass = (round) =>
    round.passed || (round.difference === "eof" && !round.timedOut && round.exitCode === 0);
  const firstEof = eofPass(first);
  const terminalEof = eofPass(terminal);
  return {
    firstExact,
    finalExact,
    firstEof,
    terminalEof,
    recoveries: Math.max(0, trial.rounds.length - 1),
    timeouts: trial.rounds.filter((round) => round.timedOut).length,
    infrastructureFailures: 0,
  };
}

async function readResults(file) {
  const [header, ...lines] = (await readFile(file, "utf8")).trim().split("\n");
  const fields = header.split(",");
  const rows = lines.map((line) =>
    Object.fromEntries(line.split(",").map((value, index) => [fields[index], value])),
  );
  if (rows.length !== 40) throw Error(`Expected 40 result rows, got ${rows.length}`);
  return rows;
}

async function readTrials(files) {
  const trials = new Map();
  for (const file of files) {
    const benchmark = JSON.parse(await readFile(file, "utf8"));
    for (const trial of benchmark.trials) {
      const key = `${trial.profile}\0${trial.task}`;
      if (trials.has(key)) throw Error(`Duplicate retained trial ${trial.profile}:${trial.task}`);
      trials.set(key, trial);
    }
  }
  return trials;
}

export function assertAlignedTrialSets(profileTrials) {
  const entries = [...profileTrials.entries()];
  if (!entries.length) throw Error("No retained profile trials to align");
  const [referenceProfile, referenceTrials] = entries[0];
  const reference = new Map(referenceTrials.map((trial) => [trial.task, trial.fixtureSha256]));
  for (const [profile, trials] of entries) {
    if (trials.length !== referenceTrials.length)
      throw Error(
        `${profile}: expected ${referenceTrials.length} aligned trials from ${referenceProfile}, got ${trials.length}`,
      );
    const candidates = new Map(trials.map((trial) => [trial.task, trial.fixtureSha256]));
    for (const [task, fixtureSha256] of reference) {
      if (!candidates.has(task)) throw Error(`${profile}: missing aligned task ${task}`);
      if (candidates.get(task) !== fixtureSha256)
        throw Error(`${profile}: fixture mismatch for ${task}`);
    }
  }
}
function buildAnalysisRows(results, trials) {
  const profileTrials = new Map(
    results.map((result) => {
      const profile = sourceProfile(result);
      return [profile, [...trials.values()].filter((trial) => trial.profile === profile)];
    }),
  );
  assertAlignedTrialSets(profileTrials);
  const familyRows = [];
  const taskRows = [];
  for (const result of results) {
    const profile = sourceProfile(result);
    const retainedTrials = profileTrials.get(profile);
    const grouped = new Map();
    for (const trial of retainedTrials) {
      const family = taskFamily(trial.task);
      const measures = trialMeasures(trial);
      taskRows.push({
        model: result.model,
        harness: result.harness,
        family,
        task: trial.task,
        ...measures,
      });
      const aggregate = grouped.get(family) ?? {
        model: result.model,
        family,
        task_count: 0,
        harness: result.harness,
        first_exact_passed: 0,
        final_exact_passed: 0,
        first_eof_passed: 0,
        terminal_eof_passed: 0,
        recovery_count: 0,
        timeout_count: 0,
        infrastructure_failures: 0,
      };
      aggregate.task_count++;
      aggregate.first_exact_passed += measures.firstExact ? 1 : 0;
      aggregate.final_exact_passed += measures.finalExact ? 1 : 0;
      aggregate.first_eof_passed += measures.firstEof ? 1 : 0;
      aggregate.terminal_eof_passed += measures.terminalEof ? 1 : 0;
      aggregate.recovery_count += measures.recoveries;
      aggregate.timeout_count += measures.timeouts;
      aggregate.infrastructure_failures += measures.infrastructureFailures;
      grouped.set(family, aggregate);
    }
    if (grouped.size !== FAMILY_PREFIXES.length)
      throw Error(
        `${profile}: expected ${FAMILY_PREFIXES.length} task families, got ${grouped.size}`,
      );
    for (const aggregate of grouped.values()) {
      aggregate.first_exact_rate = percentage(aggregate.first_exact_passed, aggregate.task_count);
      aggregate.final_exact_rate = percentage(aggregate.final_exact_passed, aggregate.task_count);
      aggregate.first_eof_rate = percentage(aggregate.first_eof_passed, aggregate.task_count);
      aggregate.terminal_eof_rate = percentage(aggregate.terminal_eof_passed, aggregate.task_count);
      const initialFailures = aggregate.task_count - aggregate.first_exact_passed;
      aggregate.initial_failures = initialFailures;
      aggregate.recovered_failures = aggregate.final_exact_passed - aggregate.first_exact_passed;
      aggregate.terminal_failures = aggregate.task_count - aggregate.final_exact_passed;
      aggregate.recovery_rate = initialFailures
        ? percentage(aggregate.recovered_failures, initialFailures)
        : null;
      familyRows.push(aggregate);
    }
    const totals = [...grouped.values()].reduce(
      (sum, row) => ({
        firstPassed: sum.firstPassed + row.first_exact_passed,
        eventualPassed: sum.eventualPassed + row.final_exact_passed,
        firstEofNormalized: sum.firstEofNormalized + row.first_eof_passed,
        terminalEofNormalized: sum.terminalEofNormalized + row.terminal_eof_passed,
        recoveries: sum.recoveries + row.recovery_count,
        timeouts: sum.timeouts + row.timeout_count,
        infrastructureFailures: sum.infrastructureFailures + row.infrastructure_failures,
      }),
      {
        firstPassed: 0,
        eventualPassed: 0,
        firstEofNormalized: 0,
        terminalEofNormalized: 0,
        recoveries: 0,
        timeouts: 0,
        infrastructureFailures: 0,
      },
    );
    for (const [field, value] of Object.entries(totals)) {
      if (value !== Number(result[field]))
        throw Error(`${profile}: family total ${field}=${value}, expected ${result[field]}`);
    }
  }
  return { familyRows, taskRows };
}

function buildVariationRows(results) {
  return [
    ["first_exact", "firstPassed"],
    ["final_exact", "eventualPassed"],
  ].map(([stage, field]) => {
    const values = results.map((row) => percentage(Number(row[field]), Number(row.tasks)));
    const models = [...new Set(results.map((row) => row.model))];
    const harnesses = [...new Set(results.map((row) => row.harness))];
    const mean = (items) => items.reduce((sum, value) => sum + value, 0) / items.length;
    const grand = mean(values);
    const total = values.reduce((sum, value) => sum + (value - grand) ** 2, 0);
    const model =
      harnesses.length *
      models.reduce((sum, name) => {
        const groupMean = mean(
          results
            .filter((row) => row.model === name)
            .map((row) => percentage(Number(row[field]), Number(row.tasks))),
        );
        return sum + (groupMean - grand) ** 2;
      }, 0);
    const harness =
      models.length *
      harnesses.reduce((sum, name) => {
        const groupMean = mean(
          results
            .filter((row) => row.harness === name)
            .map((row) => percentage(Number(row[field]), Number(row.tasks))),
        );
        return sum + (groupMean - grand) ** 2;
      }, 0);
    return {
      stage,
      model_main_effect_share: percentage(model, total),
      harness_main_effect_share: percentage(harness, total),
      interaction_and_unmeasured_share: percentage(total - model - harness, total),
    };
  });
}
function buildMeanRows(results, familyRows) {
  return results.map((result) => {
    const families = familyRows.filter(
      (row) => row.model === result.model && row.harness === result.harness,
    );
    const familyMean = (field) =>
      families.reduce((sum, row) => sum + row[field], 0) / families.length;
    const firstOfficial = percentage(Number(result.firstPassed), Number(result.tasks));
    const finalOfficial = percentage(Number(result.eventualPassed), Number(result.tasks));
    const firstFamily = familyMean("first_exact_rate");
    const finalFamily = familyMean("final_exact_rate");
    return {
      model: result.model,
      harness: result.harness,
      first_official_rate: firstOfficial,
      first_family_mean: firstFamily,
      first_delta_pp: firstFamily - firstOfficial,
      final_official_rate: finalOfficial,
      final_family_mean: finalFamily,
      final_delta_pp: finalFamily - finalOfficial,
    };
  });
}

function buildCorrelations(models, harnesses, familyRows) {
  const rows = [];
  for (const model of models) {
    const modelRows = familyRows.filter((row) => row.model === model);
    for (const [stage, field] of [
      ["first_exact", "first_exact_rate"],
      ["final_exact", "final_exact_rate"],
    ]) {
      const vectors = new Map(
        harnesses.map((harness) => [
          harness,
          FAMILY_PREFIXES.map(
            ([, family]) =>
              modelRows.find((row) => row.harness === harness && row.family === family)[field],
          ),
        ]),
      );
      for (const harness_a of harnesses) {
        for (const harness_b of harnesses) {
          rows.push({
            model,
            stage,
            harness_a,
            harness_b,
            rho: spearman(vectors.get(harness_a), vectors.get(harness_b)),
          });
        }
      }
    }
  }
  return rows;
}

function buildOverlaps(models, harnesses, taskRows) {
  const rows = [];
  for (const model of models) {
    const modelRows = taskRows.filter((row) => row.model === model);
    for (const [stage, field] of [
      ["first_exact", "firstExact"],
      ["terminal_exact", "finalExact"],
    ]) {
      const failures = new Map(
        harnesses.map((harness) => [
          harness,
          new Set(
            modelRows
              .filter((row) => row.harness === harness && !row[field])
              .map((row) => row.task),
          ),
        ]),
      );
      for (const harness_a of harnesses) {
        for (const harness_b of harnesses) {
          const a = failures.get(harness_a);
          const b = failures.get(harness_b);
          const both_fail = [...a].filter((task) => b.has(task)).length;
          const a_only_fail = [...a].filter((task) => !b.has(task)).length;
          const b_only_fail = [...b].filter((task) => !a.has(task)).length;
          const union_count = both_fail + a_only_fail + b_only_fail;
          rows.push({
            model,
            stage,
            harness_a,
            harness_b,
            intersection_count: both_fail,
            union_count,
            jaccard: union_count ? both_fail / union_count : 1,
            both_fail,
            a_only_fail,
            b_only_fail,
            both_pass: 226 - union_count,
          });
        }
      }
    }
  }
  return rows;
}

function buildCrossModelCorrelations(models, harnesses, familyRows) {
  const rows = [];
  for (const harness of harnesses) {
    const harnessRows = familyRows.filter((row) => row.harness === harness);
    for (const [stage, field] of [
      ["first_exact", "first_exact_rate"],
      ["final_exact", "final_exact_rate"],
    ]) {
      const vectors = new Map(
        models.map((model) => [
          model,
          FAMILY_PREFIXES.map(
            ([, family]) =>
              harnessRows.find((row) => row.model === model && row.family === family)[field],
          ),
        ]),
      );
      for (const model_a of models) {
        for (const model_b of models) {
          rows.push({
            harness,
            stage,
            model_a,
            model_b,
            rho: spearman(vectors.get(model_a), vectors.get(model_b)),
          });
        }
      }
    }
  }
  return rows;
}

function buildCrossModelOverlaps(models, harnesses, taskRows) {
  const rows = [];
  for (const harness of harnesses) {
    const harnessRows = taskRows.filter((row) => row.harness === harness);
    for (const [stage, field] of [
      ["first_exact", "firstExact"],
      ["terminal_exact", "finalExact"],
    ]) {
      const failures = new Map(
        models.map((model) => [
          model,
          new Set(
            harnessRows.filter((row) => row.model === model && !row[field]).map((row) => row.task),
          ),
        ]),
      );
      for (const model_a of models) {
        for (const model_b of models) {
          const a = failures.get(model_a);
          const b = failures.get(model_b);
          const both_fail = [...a].filter((task) => b.has(task)).length;
          const a_only_fail = [...a].filter((task) => !b.has(task)).length;
          const b_only_fail = [...b].filter((task) => !a.has(task)).length;
          const union_count = both_fail + a_only_fail + b_only_fail;
          rows.push({
            harness,
            stage,
            model_a,
            model_b,
            intersection_count: both_fail,
            union_count,
            jaccard: union_count ? both_fail / union_count : 1,
            both_fail,
            a_only_fail,
            b_only_fail,
            both_pass: 226 - union_count,
          });
        }
      }
    }
  }
  return rows;
}

function labelLines(label) {
  const words = label.split(" ");
  if (words.length < 3) return [label];
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
}

function renderBoxPlot({
  data,
  groups,
  file,
  title,
  description,
  yMin = 60,
  ticks,
  meanLabel = "Mean",
}) {
  const width = 1600;
  const height = 680;
  const margin = { top: 92, right: 40, bottom: 150, left: 82 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const y = (value) => margin.top + ((100 - value) / (100 - yMin)) * chartHeight;
  const groupWidth = chartWidth / groups.length;
  const boxWidth = Math.min(42, groupWidth * 0.22);
  const series = [
    { field: "first", label: "First exact", color: "#4f7cff", offset: -boxWidth * 0.7 },
    { field: "final", label: "Final exact", color: "#20a56b", offset: boxWidth * 0.7 },
  ];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escapeXml(title)}</title>`,
    `<desc id="desc">${escapeXml(description)}</desc>`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="${margin.left}" y="38" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#172033">${escapeXml(title)}</text>`,
    `<text x="${margin.left}" y="65" font-family="system-ui, sans-serif" font-size="14" fill="#536179">${escapeXml(description)}</text>`,
  ];
  for (const tick of ticks) {
    const tickY = y(tick);
    svg.push(
      `<line x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}" stroke="#dce2eb"/>`,
      `<text x="${margin.left - 12}" y="${tickY + 5}" text-anchor="end" font-family="system-ui, sans-serif" font-size="13" fill="#536179">${tick}%</text>`,
    );
  }
  groups.forEach((group, groupIndex) => {
    const center = margin.left + groupWidth * (groupIndex + 0.5);
    for (const entry of series) {
      const values = data.filter((row) => row.group === group).map((row) => row[entry.field]);
      const box = boxStats(values);
      const x = center + entry.offset;
      svg.push(
        `<line x1="${x}" y1="${y(box.high)}" x2="${x}" y2="${y(box.low)}" stroke="${entry.color}" stroke-width="2"/>`,
        `<line x1="${x - boxWidth / 3}" y1="${y(box.high)}" x2="${x + boxWidth / 3}" y2="${y(box.high)}" stroke="${entry.color}" stroke-width="2"/>`,
        `<line x1="${x - boxWidth / 3}" y1="${y(box.low)}" x2="${x + boxWidth / 3}" y2="${y(box.low)}" stroke="${entry.color}" stroke-width="2"/>`,
        `<rect x="${x - boxWidth / 2}" y="${y(box.q3)}" width="${boxWidth}" height="${Math.max(1, y(box.q1) - y(box.q3))}" fill="${entry.color}" fill-opacity="0.18" stroke="${entry.color}" stroke-width="2"/>`,
        `<line x1="${x - boxWidth / 2}" y1="${y(box.median)}" x2="${x + boxWidth / 2}" y2="${y(box.median)}" stroke="${entry.color}" stroke-width="3"/>`,
        `<circle cx="${x}" cy="${y(box.mean)}" r="4" fill="#172033"/>`,
        ...box.outliers.map(
          (value) =>
            `<circle cx="${x}" cy="${y(value)}" r="4" fill="#fff" stroke="${entry.color}" stroke-width="2"/>`,
        ),
      );
    }
    labelLines(group).forEach((label, index) =>
      svg.push(
        `<text x="${center}" y="${height - margin.bottom + 34 + index * 18}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#263248">${escapeXml(label)}</text>`,
      ),
    );
  });
  const legendY = height - 35;
  series.forEach((entry, index) => {
    const x = margin.left + index * 170;
    svg.push(
      `<rect x="${x}" y="${legendY - 13}" width="18" height="18" fill="${entry.color}" fill-opacity="0.18" stroke="${entry.color}" stroke-width="2"/>`,
      `<text x="${x + 28}" y="${legendY + 1}" font-family="system-ui, sans-serif" font-size="14" fill="#263248">${entry.label}</text>`,
    );
  });
  svg.push(
    `<circle cx="${margin.left + 370}" cy="${legendY - 4}" r="4" fill="#172033"/>`,
    `<text x="${margin.left + 384}" y="${legendY + 1}" font-family="system-ui, sans-serif" font-size="14" fill="#263248">${escapeXml(meanLabel)}</text>`,
    `<text x="${width - margin.right}" y="${legendY + 1}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#6b778c">Box: Q1–Q3 · line: median · whiskers: 1.5×IQR · hollow dots: outliers</text>`,
    "</svg>",
  );
  return writeFile(file, `${svg.join("\n")}\n`);
}

function scoreColor(value) {
  if (value == null) return "#e5e7eb";
  const hue = Math.max(0, Math.min(120, value * 1.2));
  return `hsl(${hue} 58% 78%)`;
}

function matrixColor(value, kind) {
  if (value == null) return "#e5e7eb";
  if (kind === "correlation") {
    const hue = value < 0 ? 5 : 210;
    const lightness = 96 - Math.abs(value) * 35;
    return `hsl(${hue} 65% ${lightness}%)`;
  }
  return scoreColor(value * 100);
}

function renderFamilyHeatmaps(model, harnesses, familyRows, file) {
  const width = 1600;
  const left = 280;
  const right = 30;
  const cellWidth = (width - left - right) / harnesses.length;
  const rowHeight = 25;
  const panelGap = 80;
  const panelHeader = 72;
  const panelHeight = panelHeader + FAMILY_PREFIXES.length * rowHeight;
  const panels = [
    { title: "First exact pass rate", field: "first_exact_rate" },
    { title: "Final exact pass rate", field: "final_exact_rate" },
    { title: "Recovery rate after an initial failure", field: "recovery_rate" },
  ];
  const height = 90 + panels.length * panelHeight + (panels.length - 1) * panelGap + 40;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<text x="${left}" y="38" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#172033">${escapeXml(model)}: task-family heatmaps</text>`,
    `<text x="${left}" y="64" font-family="system-ui, sans-serif" font-size="14" fill="#536179">Rows show the 19 task families; labels include each family’s task count.</text>`,
  ];
  panels.forEach((panel, panelIndex) => {
    const top = 90 + panelIndex * (panelHeight + panelGap);
    svg.push(
      `<text x="${left}" y="${top + 22}" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#263248">${panel.title}</text>`,
    );
    harnesses.forEach((harness, index) => {
      const x = left + index * cellWidth + cellWidth / 2;
      svg.push(
        `<text x="${x}" y="${top + 52}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(HARNESS_SHORT_NAMES.get(harness))}</text>`,
      );
    });
    FAMILY_PREFIXES.forEach(([, family], rowIndex) => {
      const familyRowsForModel = familyRows.filter(
        (row) => row.model === model && row.family === family,
      );
      const count = familyRowsForModel[0]?.task_count;
      const y = top + panelHeader + rowIndex * rowHeight;
      svg.push(
        `<text x="${left - 12}" y="${y + 17}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(family)} (n=${count})</text>`,
      );
      harnesses.forEach((harness, columnIndex) => {
        const row = familyRowsForModel.find((candidate) => candidate.harness === harness);
        const value = row[panel.field];
        const x = left + columnIndex * cellWidth;
        svg.push(
          `<rect x="${x}" y="${y}" width="${cellWidth}" height="${rowHeight}" fill="${scoreColor(value)}" stroke="#fff"/>`,
          `<text x="${x + cellWidth / 2}" y="${y + 17}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#172033">${value == null ? "—" : `${formatNumber(value)}%`}</text>`,
        );
      });
    });
  });
  svg.push("</svg>");
  return writeFile(file, `${svg.join("\n")}\n`);
}

function renderPairMatrices({
  model,
  harnesses,
  rows,
  stages,
  valueField,
  kind,
  title,
  description,
  file,
}) {
  const width = 1200;
  const left = 230;
  const cell = 82;
  const matrixSize = cell * harnesses.length;
  const panelHeight = 100 + matrixSize;
  const height = 90 + stages.length * panelHeight + 50;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<text x="${left}" y="36" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#172033">${escapeXml(model)}: ${escapeXml(title)}</text>`,
    `<text x="${left}" y="62" font-family="system-ui, sans-serif" font-size="14" fill="#536179">${escapeXml(description)}</text>`,
  ];
  stages.forEach(([stage, label], panelIndex) => {
    const top = 90 + panelIndex * panelHeight;
    svg.push(
      `<text x="${left}" y="${top + 20}" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#263248">${escapeXml(label)}</text>`,
    );
    harnesses.forEach((harness, index) => {
      const center = left + index * cell + cell / 2;
      svg.push(
        `<text x="${center}" y="${top + 48}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#263248">${escapeXml(HARNESS_SHORT_NAMES.get(harness))}</text>`,
      );
    });
    harnesses.forEach((harnessA, rowIndex) => {
      const y = top + 60 + rowIndex * cell;
      svg.push(
        `<text x="${left - 12}" y="${y + cell / 2 + 4}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(HARNESS_SHORT_NAMES.get(harnessA))}</text>`,
      );
      harnesses.forEach((harnessB, columnIndex) => {
        const row = rows.find(
          (candidate) =>
            candidate.model === model &&
            candidate.stage === stage &&
            candidate.harness_a === harnessA &&
            candidate.harness_b === harnessB,
        );
        const value = row[valueField];
        const x = left + columnIndex * cell;
        svg.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${matrixColor(value, kind)}" stroke="#fff"/>`,
          `<text x="${x + cell / 2}" y="${y + cell / 2 + 5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#172033">${value == null ? "—" : formatNumber(value, 2)}</text>`,
        );
      });
    });
  });
  svg.push("</svg>");
  return writeFile(file, `${svg.join("\n")}\n`);
}

function renderHarnessHeatmaps(harness, models, familyRows, file) {
  const width = 1320;
  const left = 280;
  const right = 30;
  const cellWidth = (width - left - right) / models.length;
  const rowHeight = 25;
  const panelGap = 80;
  const panelHeader = 72;
  const panelHeight = panelHeader + FAMILY_PREFIXES.length * rowHeight;
  const panels = [
    { title: "First exact pass rate", field: "first_exact_rate" },
    { title: "Final exact pass rate", field: "final_exact_rate" },
    { title: "Recovery rate after an initial failure", field: "recovery_rate" },
  ];
  const height = 90 + panels.length * panelHeight + (panels.length - 1) * panelGap + 40;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<text x="${left}" y="38" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#172033">${escapeXml(harness)}: task-family heatmaps</text>`,
    `<text x="${left}" y="64" font-family="system-ui, sans-serif" font-size="14" fill="#536179">Columns show five models; rows show 19 task families.</text>`,
  ];
  panels.forEach((panel, panelIndex) => {
    const top = 90 + panelIndex * (panelHeight + panelGap);
    svg.push(
      `<text x="${left}" y="${top + 22}" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#263248">${panel.title}</text>`,
    );
    models.forEach((model, index) => {
      const x = left + index * cellWidth + cellWidth / 2;
      svg.push(
        `<text x="${x}" y="${top + 52}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(MODEL_SHORT_NAMES.get(model))}</text>`,
      );
    });
    FAMILY_PREFIXES.forEach(([, family], rowIndex) => {
      const rows = familyRows.filter((row) => row.harness === harness && row.family === family);
      const y = top + panelHeader + rowIndex * rowHeight;
      svg.push(
        `<text x="${left - 12}" y="${y + 17}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(family)} (n=${rows[0]?.task_count})</text>`,
      );
      models.forEach((model, columnIndex) => {
        const row = rows.find((candidate) => candidate.model === model);
        const value = row[panel.field];
        const x = left + columnIndex * cellWidth;
        svg.push(
          `<rect x="${x}" y="${y}" width="${cellWidth}" height="${rowHeight}" fill="${scoreColor(value)}" stroke="#fff"/>`,
          `<text x="${x + cellWidth / 2}" y="${y + 17}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#172033">${value == null ? "—" : `${formatNumber(value)}%`}</text>`,
        );
      });
    });
  });
  svg.push("</svg>");
  return writeFile(file, `${svg.join("\n")}\n`);
}

function renderCrossModelMatrices({
  harness,
  models,
  rows,
  stages,
  valueField,
  kind,
  title,
  file,
}) {
  const width = 980;
  const left = 230;
  const cell = 110;
  const panelHeight = 100 + cell * models.length;
  const height = 90 + stages.length * panelHeight + 50;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<text x="${left}" y="36" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#172033">${escapeXml(harness)}: ${escapeXml(title)}</text>`,
  ];
  stages.forEach(([stage, label], panelIndex) => {
    const top = 90 + panelIndex * panelHeight;
    svg.push(
      `<text x="${left}" y="${top + 20}" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#263248">${escapeXml(label)}</text>`,
    );
    models.forEach((model, index) => {
      const center = left + index * cell + cell / 2;
      svg.push(
        `<text x="${center}" y="${top + 48}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#263248">${escapeXml(MODEL_SHORT_NAMES.get(model))}</text>`,
      );
    });
    models.forEach((modelA, rowIndex) => {
      const y = top + 60 + rowIndex * cell;
      svg.push(
        `<text x="${left - 12}" y="${y + cell / 2 + 4}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#263248">${escapeXml(MODEL_SHORT_NAMES.get(modelA))}</text>`,
      );
      models.forEach((modelB, columnIndex) => {
        const row = rows.find(
          (candidate) =>
            candidate.harness === harness &&
            candidate.stage === stage &&
            candidate.model_a === modelA &&
            candidate.model_b === modelB,
        );
        const value = row[valueField];
        const x = left + columnIndex * cell;
        svg.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${matrixColor(value, kind)}" stroke="#fff"/>`,
          `<text x="${x + cell / 2}" y="${y + cell / 2 + 5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#172033">${value == null ? "—" : formatNumber(value, 2)}</text>`,
        );
      });
    });
  });
  svg.push("</svg>");
  return writeFile(file, `${svg.join("\n")}\n`);
}
function renderLowFamilyLines(model, harnesses, familyRows, stage, field) {
  const lines = [];
  for (const harness of harnesses) {
    const low = familyRows
      .filter((row) => row.model === model && row.harness === harness && row[field] < 75)
      .sort((a, b) => a[field] - b[field] || a.family.localeCompare(b.family));
    if (!low.length) continue;
    lines.push(
      `- **${harness}:** ${low
        .map((row) => `${row.family} (${formatNumber(row[field])}%, n=${row.task_count})`)
        .join(", ")}.`,
    );
  }
  return lines.length ? [`### ${stage}`, "", ...lines, ""] : [];
}

function buildModelMarkdown(model, harnesses, meanRows, familyRows) {
  const slug = MODEL_FILES.get(model);
  const rows = meanRows.filter((row) => row.model === model);
  const bestFirst = rows.reduce((best, row) =>
    row.first_official_rate > best.first_official_rate ? row : best,
  );
  const worstFirst = rows.reduce((worst, row) =>
    row.first_official_rate < worst.first_official_rate ? row : worst,
  );
  const bestFinal = rows.reduce((best, row) =>
    row.final_official_rate > best.final_official_rate ? row : best,
  );
  const worstFinal = rows.reduce((worst, row) =>
    row.final_official_rate < worst.final_official_rate ? row : worst,
  );
  const output = [
    `# ${model}: harness comparison`,
    "",
    `First exact ranges from ${formatNumber(worstFirst.first_official_rate)}% in ${worstFirst.harness} to ${formatNumber(bestFirst.first_official_rate)}% in ${bestFirst.harness}. After same-session recovery, the range narrows to ${formatNumber(worstFinal.final_official_rate)}%–${formatNumber(bestFinal.final_official_rate)}%, led by ${bestFinal.harness}. These scores describe the complete model, provider route and harness combination.`,
    "",
    "[Back to the baseline index](../README.md) · [Scoreboard](../scoreboard.md) · [Task families](../task-families.md) · [Recovery](../recovery.md) · [Failure shape](../failure-shape.md)",
    "",
    `[Tool use across harnesses](../trajectories/models/${slug}.md)`,
    "",
    "## Weighted score and equal-family mean",
    "",
    "The official score weights all 226 tasks equally. The family mean gives each of the 19 task families equal weight. A large delta means the task mix affects the headline score.",
    "",
    "| Harness | First official | First family mean | Δ | Final official | Final family mean | Δ |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const harness of harnesses) {
    const row = rows.find((candidate) => candidate.harness === harness);
    output.push(
      `| ${harness} | ${formatNumber(row.first_official_rate)}% | ${formatNumber(row.first_family_mean)}% | ${formatNumber(row.first_delta_pp)} pp | ${formatNumber(row.final_official_rate)}% | ${formatNumber(row.final_family_mean)}% | ${formatNumber(row.final_delta_pp)} pp |`,
    );
  }
  output.push(
    "",
    `![${model} exact scores by task family](assets/task-family-distribution-${slug}.svg)`,
    "",
    "The box shows the spread across 19 families. The dark dot is their unweighted mean.",
    "",
    "## Where the scores come from",
    "",
    `![${model} task-family heatmaps](assets/task-family-heatmaps-${slug}.svg)`,
    "",
    "The three panels show first exact, final exact and recovery after an initial failure.",
    "",
    "## Do harnesses struggle in the same places?",
    "",
    `![${model} task-family Spearman correlations](assets/task-family-correlations-${slug}.svg)`,
    "",
    "Spearman rho compares the order of family difficulty. Blank cells mean at least one 19-family vector is constant, so rho is undefined.",
    "",
    `![${model} task-level failure overlap](assets/task-failure-overlap-${slug}.svg)`,
    "",
    "Jaccard compares failed task-ID sets. A value of 1 means identical sets; two empty sets also score 1 by convention.",
    "",
    "## Family rates below 75%",
    "",
    "Only weak cells are listed. Harnesses with no family below 75% at a stage are omitted.",
    "",
    ...renderLowFamilyLines(model, harnesses, familyRows, "First exact", "first_exact_rate"),
    ...renderLowFamilyLines(model, harnesses, familyRows, "Final exact", "final_exact_rate"),
  );
  return output.join("\n");
}

function renderHarnessLowFamilyLines(harness, models, familyRows, stage, field) {
  const lines = [];
  for (const model of models) {
    const low = familyRows
      .filter((row) => row.harness === harness && row.model === model && row[field] < 75)
      .sort((a, b) => a[field] - b[field] || a.family.localeCompare(b.family));
    if (!low.length) continue;
    lines.push(
      `- **${model}:** ${low
        .map((row) => `${row.family} (${formatNumber(row[field])}%, n=${row.task_count})`)
        .join(", ")}.`,
    );
  }
  return lines.length ? [`### ${stage}`, "", ...lines, ""] : [];
}

function buildHarnessMarkdown(harness, models, meanRows, familyRows) {
  const slug = HARNESS_FILES.get(harness);
  const rows = meanRows.filter((row) => row.harness === harness);
  const bestFirst = rows.reduce((best, row) =>
    row.first_official_rate > best.first_official_rate ? row : best,
  );
  const worstFirst = rows.reduce((worst, row) =>
    row.first_official_rate < worst.first_official_rate ? row : worst,
  );
  const bestFinal = rows.reduce((best, row) =>
    row.final_official_rate > best.final_official_rate ? row : best,
  );
  const worstFinal = rows.reduce((worst, row) =>
    row.final_official_rate < worst.final_official_rate ? row : worst,
  );
  const output = [
    `# ${harness}: model comparison`,
    "",
    `First exact ranges from ${formatNumber(worstFirst.first_official_rate)}% for ${worstFirst.model} to ${formatNumber(bestFirst.first_official_rate)}% for ${bestFirst.model}. After recovery, the range is ${formatNumber(worstFinal.final_official_rate)}%–${formatNumber(bestFinal.final_official_rate)}%, led by ${bestFinal.model}. Provider routes remain part of each profile.`,
    "",
    `[Back to the baseline index](../README.md) · [Scoreboard](../scoreboard.md) · [Task families](../task-families.md) · [Recovery](../recovery.md) · [Failure shape](../failure-shape.md) · [Tool use across models](../trajectories/harnesses/${slug}.md)`,
    "",
    "## Weighted score and equal-family mean",
    "",
    "| Model | First official | First family mean | Δ | Final official | Final family mean | Δ |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const model of models) {
    const row = rows.find((candidate) => candidate.model === model);
    output.push(
      `| ${model} | ${formatNumber(row.first_official_rate)}% | ${formatNumber(row.first_family_mean)}% | ${formatNumber(row.first_delta_pp)} pp | ${formatNumber(row.final_official_rate)}% | ${formatNumber(row.final_family_mean)}% | ${formatNumber(row.final_delta_pp)} pp |`,
    );
  }
  output.push(
    "",
    `![${harness} exact scores by task family](assets/task-family-distribution-${slug}.svg)`,
    "",
    "Each box contains the 19 family rates for one model. The dark dot is the unweighted family mean.",
    "",
    "## Where the scores come from",
    "",
    `![${harness} task-family heatmaps](assets/task-family-heatmaps-${slug}.svg)`,
    "",
    "## Do models struggle in the same places?",
    "",
    `![${harness} cross-model family correlations](assets/model-family-correlations-${slug}.svg)`,
    "",
    "Spearman rho compares the order of family difficulty across models. Blank cells mean a constant vector.",
    "",
    `![${harness} cross-model failure overlap](assets/model-failure-overlap-${slug}.svg)`,
    "",
    "Jaccard compares exact failed task-ID sets across models.",
    "",
    "## Family rates below 75%",
    "",
    "Only weak cells are listed. Models with no family below 75% at a stage are omitted.",
    "",
    ...renderHarnessLowFamilyLines(harness, models, familyRows, "First exact", "first_exact_rate"),
    ...renderHarnessLowFamilyLines(harness, models, familyRows, "Final exact", "final_exact_rate"),
  );
  return output.join("\n");
}
function buildTaskFamiliesMarkdown(models, harnesses, familyRows) {
  const aggregates = FAMILY_PREFIXES.map(([, family]) => {
    const rows = familyRows.filter((row) => row.family === family);
    return {
      family,
      tasks: rows[0].task_count,
      first: percentage(
        rows.reduce((sum, row) => sum + row.first_exact_passed, 0),
        rows.reduce((sum, row) => sum + row.task_count, 0),
      ),
      final: percentage(
        rows.reduce((sum, row) => sum + row.final_exact_passed, 0),
        rows.reduce((sum, row) => sum + row.task_count, 0),
      ),
      firstLow: rows.filter((row) => row.first_exact_rate < 75).length,
      finalLow: rows.filter((row) => row.final_exact_rate < 75).length,
    };
  }).sort((a, b) => a.first - b.first);
  const output = [
    "# Task families",
    "",
    "Delete subset is the broadest persistent weakness. Move between files is also difficult on the first turn, but most profiles repair it during recovery. The table averages each family across all 40 model-harness profiles.",
    "",
    "[Back to the baseline index](README.md) · [Scoreboard](scoreboard.md) · [Recovery](recovery.md) · [Failure shape](failure-shape.md)",
    "",
    "| Family | Tasks per profile | Mean first exact | Profiles below 75% | Mean final exact | Profiles below 75% |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const row of aggregates) {
    output.push(
      `| ${row.family} | ${row.tasks} | ${formatNumber(row.first)}% | ${row.firstLow}/40 | ${formatNumber(row.final)}% | ${row.finalLow}/40 |`,
    );
  }
  output.push(
    "",
    "## Main findings",
    "",
    "- **Delete subset stays hard:** 51.3% mean first exact and 68.8% final exact. It is below 75% in 26 profiles initially and 18 after recovery.",
    "- **Move between files is usually recoverable:** 69.2% mean first exact rises to 94.2% final exact. The count below 75% falls from 22 profiles to 4.",
    "- **Some weaknesses belong to a route, not every harness:** Luna DSH Code scores 33.3% first exact on Delete block versus 97.6% across Luna's other harnesses, then recovers to 100%. Luna Codex shows the same 33.3% → 100% pattern on Insert payload.",
    "- **Luna's final language weakness is shared:** Codex finishes at 68.5% and Copilot at 70.4% on Language variants. This is not a Codex-only result.",
    "- **MiMo has a persistent IDE-specific cell:** Pi Agent IDE scores 16.7% first and 50.0% final on Insert payload, versus 45.2% and 83.3% across MiMo's other harnesses.",
    "",
    "## Model detail",
    "",
    ...models.map((model) => `- [${model}](models/${MODEL_FILES.get(model)}.md)`),
    "",
    "## Harness detail",
    "",
    ...harnesses.map((harness) => `- [${harness}](harnesses/${HARNESS_FILES.get(harness)}.md)`),
    "",
    "## Data",
    "",
    "- [`family-results.csv`](data/family-results.csv): all 760 model × harness × family rows.",
    "- [`weighted-vs-family-mean.csv`](data/weighted-vs-family-mean.csv): official task-weighted scores beside equal-family means.",
    "",
    "The task set contains scaled variants, plain/Unicode twins and repeated operations. This analysis is descriptive and does not treat all 226 outcomes as independent IID observations.",
    "",
  );
  return output.join("\n");
}

function buildRecoveryMarkdown(results, familyRows) {
  const profileGains = results
    .map((row) => ({
      model: row.model,
      harness: row.harness,
      first: percentage(Number(row.firstPassed), Number(row.tasks)),
      final: percentage(Number(row.eventualPassed), Number(row.tasks)),
      recovered: Number(row.eventualPassed) - Number(row.firstPassed),
      rounds: Number(row.recoveries),
      timeouts: Number(row.timeouts),
    }))
    .sort((a, b) => b.recovered - a.recovered);
  const familyRecovery = FAMILY_PREFIXES.map(([, family]) => {
    const rows = familyRows.filter((row) => row.family === family);
    const initial = rows.reduce((sum, row) => sum + row.initial_failures, 0);
    const recovered = rows.reduce((sum, row) => sum + row.recovered_failures, 0);
    return { family, initial, recovered, rate: initial ? percentage(recovered, initial) : null };
  }).sort((a, b) => b.recovered - a.recovered);
  const output = [
    "# Same-session recovery",
    "",
    "Recovery changes the ranking because it measures whether a profile can repair its own failed edit after verifier feedback. It is not a fresh independent attempt.",
    "",
    "[Back to the baseline index](README.md) · [Scoreboard](scoreboard.md) · [Task families](task-families.md) · [Failure shape](failure-shape.md)",
    "",
    "## Largest score gains",
    "",
    "These ten profiles recovered the most tasks between the first and terminal exact score.",
    "",
    "| Model | Harness | First exact | Final exact | Tasks recovered | Extra rounds | Timeouts |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const row of profileGains.slice(0, 10)) {
    output.push(
      `| ${row.model} | ${row.harness} | ${formatNumber(row.first)}% | ${formatNumber(row.final)}% | ${row.recovered} | ${row.rounds} | ${row.timeouts} |`,
    );
  }
  output.push(
    "",
    "MiMo and Luna account for most of the largest gains. That does not make their routes efficient: some gains required many continuation rounds, and MiMo also accumulated many timeouts.",
    "",
    "## Recovery by task family",
    "",
    "The rate is recovered initial failures divided by all initial failures in that family across 40 profiles.",
    "",
    "| Family | Initial failures | Recovered | Recovery rate |",
    "|---|---:|---:|---:|",
  );
  for (const row of familyRecovery) {
    output.push(
      `| ${row.family} | ${row.initial} | ${row.recovered} | ${row.rate == null ? "—" : `${formatNumber(row.rate)}%`} |`,
    );
  }
  output.push(
    "",
    "Per-model recovery heatmaps are on the [five model pages](task-families.md#model-detail). Raw family recovery counts are in [`family-results.csv`](data/family-results.csv).",
    "",
  );
  return output.join("\n");
}

function buildFailureShapeMarkdown(models) {
  return [
    "# Failure shape",
    "",
    "Similar aggregate scores do not imply the same weaknesses. Spearman compares how harnesses rank the 19 task families. Jaccard compares the exact failed task IDs.",
    "",
    "[Back to the baseline index](README.md) · [Scoreboard](scoreboard.md) · [Task families](task-families.md) · [Recovery](recovery.md)",
    "",
    "## Same score, different failures",
    "",
    "DeepSeek V4 Flash in OMP and DSH Standard both score 221/226 first exact. Each misses five tasks, but the failure sets are disjoint: Jaccard 0.00. Their family-difficulty correlation is also negative (rho −0.26). The equal totals hide different weaknesses.",
    "",
    "GLM Copilot and DSH Code both finish at 223/226. Their three terminal failures are also disjoint.",
    "",
    "## Similar score, shared failures",
    "",
    "Luna Codex and Copilot score 172/226 and 171/226 first exact. They share 45 failures; Codex has 9 additional failures and Copilot 10. Their Jaccard overlap is 0.703 and family correlation is 0.63. Here the similar totals reflect many of the same weak tasks.",
    "",
    "## Read the matrices",
    "",
    "- **Spearman rho:** +1 means the family rankings match, 0 means no monotonic relation and −1 means opposite rankings. Blank means one vector is constant, so correlation is undefined.",
    "- **Jaccard:** intersection divided by union for failed task sets. 0 means no shared failures; 1 means identical failure sets. Two empty sets score 1 by convention.",
    "- These are descriptive comparisons. They do not identify whether the model, provider route or harness caused a difference.",
    "",
    "## Model matrices",
    "",
    ...models.map(
      (model) =>
        `- [${model}](models/${MODEL_FILES.get(model)}.md#do-harnesses-struggle-in-the-same-places)`,
    ),
    "",
    "Numeric values and paired counts are in [`task-family-correlations.csv`](data/task-family-correlations.csv) and [`task-failure-overlap.csv`](data/task-failure-overlap.csv).",
    "",
  ].join("\n");
}

async function main() {
  const input = process.argv[2];
  const outputDirectory = process.argv[3];
  const benchmarkFiles = process.argv.slice(4);
  if (!input || !outputDirectory || !benchmarkFiles.length)
    throw Error(
      "Usage: build-baseline-analysis.mjs RESULTS.csv OUTPUT_DIRECTORY BENCHMARK.json [...]",
    );

  const results = await readResults(input);
  const trials = await readTrials(benchmarkFiles);
  const { familyRows, taskRows } = buildAnalysisRows(results, trials);
  const models = [...new Set(results.map((row) => row.model))];
  const harnesses = [...new Set(results.map((row) => row.harness))];
  const variationRows = buildVariationRows(results);
  const meanRows = buildMeanRows(results, familyRows);
  const correlations = buildCorrelations(models, harnesses, familyRows);
  const overlaps = buildOverlaps(models, harnesses, taskRows);
  const modelCorrelations = buildCrossModelCorrelations(models, harnesses, familyRows);
  const modelOverlaps = buildCrossModelOverlaps(models, harnesses, taskRows);
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(path.join(outputDirectory, "models", "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "harnesses", "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
  await mkdir(path.join(outputDirectory, "data"), { recursive: true });

  const familyFields = [
    "model",
    "family",
    "task_count",
    "harness",
    "first_exact_passed",
    "first_exact_rate",
    "final_exact_passed",
    "final_exact_rate",
    "first_eof_rate",
    "terminal_eof_rate",
    "recovery_count",
    "timeout_count",
    "infrastructure_failures",
    "initial_failures",
    "recovered_failures",
    "terminal_failures",
    "recovery_rate",
  ];
  const meanFields = [
    "model",
    "harness",
    "first_official_rate",
    "first_family_mean",
    "first_delta_pp",
    "final_official_rate",
    "final_family_mean",
    "final_delta_pp",
  ];
  const variationFields = [
    "stage",
    "model_main_effect_share",
    "harness_main_effect_share",
    "interaction_and_unmeasured_share",
  ];
  const correlationFields = ["model", "stage", "harness_a", "harness_b", "rho"];
  const overlapFields = [
    "model",
    "stage",
    "harness_a",
    "harness_b",
    "intersection_count",
    "union_count",
    "jaccard",
    "both_fail",
    "a_only_fail",
    "b_only_fail",
    "both_pass",
  ];
  const modelCorrelationFields = ["harness", "stage", "model_a", "model_b", "rho"];
  const modelOverlapFields = [
    "harness",
    "stage",
    "model_a",
    "model_b",
    "intersection_count",
    "union_count",
    "jaccard",
    "both_fail",
    "a_only_fail",
    "b_only_fail",
    "both_pass",
  ];
  const writes = [
    writeFile(
      path.join(outputDirectory, "data", "family-results.csv"),
      csv(familyRows, familyFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "weighted-vs-family-mean.csv"),
      csv(meanRows, meanFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "variation-decomposition.csv"),
      csv(variationRows, variationFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "task-family-correlations.csv"),
      csv(correlations, correlationFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "task-failure-overlap.csv"),
      csv(overlaps, overlapFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "model-family-correlations.csv"),
      csv(modelCorrelations, modelCorrelationFields),
    ),
    writeFile(
      path.join(outputDirectory, "data", "model-failure-overlap.csv"),
      csv(modelOverlaps, modelOverlapFields),
    ),
    writeFile(
      path.join(outputDirectory, "task-families.md"),
      buildTaskFamiliesMarkdown(models, harnesses, familyRows),
    ),
    writeFile(
      path.join(outputDirectory, "recovery.md"),
      buildRecoveryMarkdown(results, familyRows),
    ),
    writeFile(path.join(outputDirectory, "failure-shape.md"), buildFailureShapeMarkdown(models)),
    ...models.map((model) =>
      writeFile(
        path.join(outputDirectory, "models", `${MODEL_FILES.get(model)}.md`),
        buildModelMarkdown(model, harnesses, meanRows, familyRows),
      ),
    ),
    ...harnesses.map((harness) =>
      writeFile(
        path.join(outputDirectory, "harnesses", `${HARNESS_FILES.get(harness)}.md`),
        buildHarnessMarkdown(harness, models, meanRows, familyRows),
      ),
    ),
  ];

  const overallBoxRows = results.flatMap((row) => [
    {
      group: row.harness,
      first: percentage(Number(row.firstPassed), Number(row.tasks)),
      final: percentage(Number(row.eventualPassed), Number(row.tasks)),
      model: row.model,
    },
  ]);
  writes.push(
    renderBoxPlot({
      data: overallBoxRows,
      groups: harnesses,
      file: path.join(outputDirectory, "assets", "exact-score-distribution-by-harness.svg"),
      title: "Exact score distribution by harness",
      description: "Each box contains five model scores over the same 226 tasks.",
      ticks: [60, 70, 80, 90, 100],
    }),
  );
  const modelBoxRows = results.map((row) => ({
    group: row.model,
    first: percentage(Number(row.firstPassed), Number(row.tasks)),
    final: percentage(Number(row.eventualPassed), Number(row.tasks)),
  }));
  writes.push(
    renderBoxPlot({
      data: modelBoxRows,
      groups: models,
      file: path.join(outputDirectory, "assets", "exact-score-distribution-by-model.svg"),
      title: "Exact score distribution by model",
      description: "Each box contains eight harness scores over the same 226 tasks.",
      ticks: [60, 70, 80, 90, 100],
    }),
  );

  for (const model of models) {
    const slug = MODEL_FILES.get(model);
    const modelFamilies = familyRows.filter((row) => row.model === model);
    const boxRows = modelFamilies.map((row) => ({
      group: row.harness,
      first: row.first_exact_rate,
      final: row.final_exact_rate,
    }));
    writes.push(
      renderBoxPlot({
        data: boxRows,
        groups: harnesses,
        file: path.join(
          outputDirectory,
          "models",
          "assets",
          `task-family-distribution-${slug}.svg`,
        ),
        title: `${model}: exact scores by task family`,
        description:
          "Each box contains exact pass rates for 19 task families; family sizes differ.",
        yMin: 0,
        ticks: [0, 20, 40, 60, 80, 100],
        meanLabel: "Unweighted mean across task families",
      }),
      renderFamilyHeatmaps(
        model,
        harnesses,
        familyRows,
        path.join(outputDirectory, "models", "assets", `task-family-heatmaps-${slug}.svg`),
      ),
      renderPairMatrices({
        model,
        harnesses,
        rows: correlations,
        stages: [
          ["first_exact", "First exact"],
          ["final_exact", "Final exact"],
        ],
        valueField: "rho",
        kind: "correlation",
        title: "task-family Spearman correlation",
        description: "Each cell compares two 19-family pass-rate vectors (rho from −1 to +1).",
        file: path.join(
          outputDirectory,
          "models",
          "assets",
          `task-family-correlations-${slug}.svg`,
        ),
      }),
      renderPairMatrices({
        model,
        harnesses,
        rows: overlaps,
        stages: [
          ["first_exact", "First exact failures"],
          ["terminal_exact", "Terminal exact failures"],
        ],
        valueField: "jaccard",
        kind: "overlap",
        title: "task-level failure overlap",
        description: "Each cell is Jaccard overlap between two failed task-ID sets (0 to 1).",
        file: path.join(outputDirectory, "models", "assets", `task-failure-overlap-${slug}.svg`),
      }),
    );
  }
  for (const harness of harnesses) {
    const slug = HARNESS_FILES.get(harness);
    const harnessFamilies = familyRows.filter((row) => row.harness === harness);
    writes.push(
      renderBoxPlot({
        data: harnessFamilies.map((row) => ({
          group: row.model,
          first: row.first_exact_rate,
          final: row.final_exact_rate,
        })),
        groups: models,
        file: path.join(
          outputDirectory,
          "harnesses",
          "assets",
          `task-family-distribution-${slug}.svg`,
        ),
        title: `${harness}: exact scores by task family`,
        description: "Each box contains 19 task-family rates for one model.",
        yMin: 0,
        ticks: [0, 20, 40, 60, 80, 100],
        meanLabel: "Unweighted mean across task families",
      }),
      renderHarnessHeatmaps(
        harness,
        models,
        familyRows,
        path.join(outputDirectory, "harnesses", "assets", `task-family-heatmaps-${slug}.svg`),
      ),
      renderCrossModelMatrices({
        harness,
        models,
        rows: modelCorrelations,
        stages: [
          ["first_exact", "First exact"],
          ["final_exact", "Final exact"],
        ],
        valueField: "rho",
        kind: "correlation",
        title: "cross-model family correlation",
        file: path.join(
          outputDirectory,
          "harnesses",
          "assets",
          `model-family-correlations-${slug}.svg`,
        ),
      }),
      renderCrossModelMatrices({
        harness,
        models,
        rows: modelOverlaps,
        stages: [
          ["first_exact", "First exact failures"],
          ["terminal_exact", "Terminal exact failures"],
        ],
        valueField: "jaccard",
        kind: "overlap",
        title: "cross-model failure overlap",
        file: path.join(
          outputDirectory,
          "harnesses",
          "assets",
          `model-failure-overlap-${slug}.svg`,
        ),
      }),
    );
  }
  await Promise.all(writes);
  console.log(`Built baseline family analysis for ${models.length} models in ${outputDirectory}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
