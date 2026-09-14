import { pathToFileURL } from "node:url";
import path from "node:path";
import { makeAdapter } from "./prepare-benchmark.mjs";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertId(kind, value) {
  if (typeof value !== "string" || !ID.test(value)) throw Error(`Invalid ${kind}: ${value}`);
}

/** Mark a trusted local object as a benchmark configuration. */
export function defineBenchmarkConfig(config) {
  if (!config || typeof config !== "object") throw Error("Benchmark config must be an object");
  return config;
}

/** Define how one installed and authenticated harness creates model-specific adapters. */
export function defineHarness(definition) {
  if (!definition || typeof definition.createAdapter !== "function")
    throw Error("Harness definition requires createAdapter");
  return definition;
}

/** Create a model-aware definition for one of the built-in CLI adapters. */
export function builtInHarness(options) {
  const { selector = "default", ...adapterOptions } = options;
  return defineHarness({
    createAdapter: ({ model, overrides }) => {
      const selectedModel = model.selectors?.[selector];
      if (!selectedModel) throw Error(`${options.harness}: model has no ${selector} selector`);
      const adapter = makeAdapter({
        ...adapterOptions,
        ...overrides,
        model: selectedModel,
        thinking: model.thinking,
        provider: model.provider ?? adapterOptions.provider,
      });
      return {
        ...adapter,
        agentFamily: options.agentFamily,
        agentVersion: options.agentVersion,
        modelFamily: model.family,
        modelVersion: model.version,
        provider: model.provider ?? null,
        harnessFamily: options.harnessFamily ?? options.harness,
        adapterVersion: options.adapterVersion,
        configurationLabels: options.configurationLabels,
        ready: overrides.ready ?? options.ready ?? adapter.ready,
      };
    },
  });
}

function selectedCells(config) {
  const cells = [];
  for (const block of config.selection?.matrix ?? []) {
    for (const model of block.models ?? []) {
      for (const harness of block.harnesses ?? []) cells.push({ model, harness });
    }
  }
  cells.push(...(config.selection?.pairs ?? []));
  return cells;
}

/** Expand matrix blocks and explicit pairs into the immutable leaf adapters used by the runner. */
export async function resolveBenchmarkProfiles(config) {
  defineBenchmarkConfig(config);
  const models = config.models ?? {};
  const harnesses = config.harnesses ?? {};
  const profiles = {};
  const seenCells = new Set();
  const seenProfiles = new Set();
  for (const cell of selectedCells(config)) {
    assertId("model id", cell.model);
    assertId("harness id", cell.harness);
    if (!models[cell.model]) throw Error(`Unknown model: ${cell.model}`);
    if (!harnesses[cell.harness]) throw Error(`Unknown harness: ${cell.harness}`);
    const cellId = `${cell.model}\0${cell.harness}`;
    if (seenCells.has(cellId))
      throw Error(`Duplicate model-harness cell: ${cell.model}/${cell.harness}`);
    seenCells.add(cellId);
    const profileId = cell.profile ?? `${cell.model}-${cell.harness}`;
    assertId("profile id", profileId);
    if (seenProfiles.has(profileId)) throw Error(`Duplicate profile id: ${profileId}`);
    seenProfiles.add(profileId);
    const definition = defineHarness(harnesses[cell.harness]);
    const adapter = await definition.createAdapter({
      model: models[cell.model],
      modelId: cell.model,
      harnessId: cell.harness,
      profileId,
      overrides: cell.overrides ?? {},
    });
    if (!adapter || typeof adapter !== "object")
      throw Error(`${profileId}: createAdapter must return an adapter object`);
    if (!adapter.model || !adapter.thinking)
      throw Error(`${profileId}: adapter requires explicit model and thinking`);
    profiles[profileId] = {
      ...adapter,
      profileId,
      modelId: cell.model,
      // Published data names the harness family, not the internal config key.
      harnessId: adapter.harnessFamily ?? cell.harness,
      // A harness without its own version number is published at the version of its CLI.
      harnessVersion: adapter.harnessVersion ?? adapter.version,
      ...(definition.inspectOutput ? { inspectOutput: definition.inspectOutput } : {}),
      ...(definition.continueSession ? { continueSession: definition.continueSession } : {}),
    };
  }
  if (!Object.keys(profiles).length) throw Error("Benchmark selection produced no profiles");
  return profiles;
}

/** Load JSON compatibility configs or trusted TypeScript/JavaScript benchmark modules. */
export async function loadBenchmarkProfiles(file) {
  const absolute = path.resolve(file);
  if (path.extname(absolute) === ".json") {
    const config = JSON.parse(await (await import("node:fs/promises")).readFile(absolute, "utf8"));
    const harnesses = config.harnesses ?? config.profiles ?? config;
    // Published identity is the harness family, so JSON adapters get one even when they omit it.
    return Object.fromEntries(
      Object.entries(harnesses).map(([name, adapter]) => [
        name,
        {
          ...adapter,
          harnessId: adapter.harnessId ?? adapter.harnessFamily ?? adapter.kind ?? name,
        },
      ]),
    );
  }
  const module = await import(`${pathToFileURL(absolute).href}?loaded=${Date.now()}`);
  return resolveBenchmarkProfiles(module.default ?? module.config);
}
