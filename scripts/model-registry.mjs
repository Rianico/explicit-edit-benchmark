import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canonicalIdentityJson } from "./official-identities.mjs";

const REGISTRY_FILE = fileURLToPath(new URL("../registries/models/v1.json", import.meta.url));
const ID = /^[a-z0-9][a-z0-9._-]*$/u;

function validateRegistry(registry) {
  if (registry?.schemaVersion !== 1 || typeof registry.registryId !== "string")
    throw Error("Unsupported model registry");
  const routes = new Set();
  for (const model of registry.models ?? []) {
    if (!ID.test(model.id) || typeof model.displayName !== "string" || !model.displayName)
      throw Error("Invalid canonical model identity");
    for (const route of model.routes ?? []) {
      const key = `${route.provider}/${route.selector}`;
      if (routes.has(key)) throw Error(`Duplicate model route: ${key}`);
      routes.add(key);
    }
  }
  return registry;
}

/** Load the immutable model identity registry shipped with this runner revision. */
export async function loadModelRegistry() {
  return validateRegistry(JSON.parse(await readFile(REGISTRY_FILE, "utf8")));
}

/** Resolve a provider selector while preserving the exact selector used on the wire. */
export async function resolveCanonicalModel(provider, selector) {
  const registry = await loadModelRegistry();
  const match = registry.models.find((model) =>
    model.routes.some((route) => route.provider === provider && route.selector === selector),
  );
  const model = match ?? { id: selector, displayName: selector, sourceUrl: null };
  return {
    canonicalModel: {
      id: model.id,
      displayName: model.displayName,
      sourceUrl: model.sourceUrl,
    },
    modelRegistry: {
      id: registry.registryId,
      sha256: createHash("sha256").update(canonicalIdentityJson(registry)).digest("hex"),
    },
  };
}
