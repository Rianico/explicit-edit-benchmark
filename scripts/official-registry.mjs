import { createHash } from "node:crypto";
import { canonicalIdentityJson } from "./official-identities.mjs";

const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const MODEL = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const OFFICIAL_REGISTRY_URL = "https://registry.npmjs.org";

/** Reviewed adapters available to official callers. Local benchmark configs remain unrestricted. */
export const OFFICIAL_ADAPTERS = Object.freeze({
  "pi-default": {
    agentFamily: "pi",
    harnessFamily: "pi-default",
    binary: "pi",
    packages: [
      { role: "agent", name: "@earendil-works/pi-coding-agent", versionInput: "agentVersion" },
    ],
    providers: ["openai-codex"],
    credentialSchemas: {
      "openai-codex": {
        required: ["type", "access", "refresh", "expires", "accountId"],
        allowed: ["type", "access", "refresh", "expires", "accountId"],
        type: "oauth",
      },
    },
  },
  "pi-agent-ide": {
    agentFamily: "pi",
    harnessFamily: "pi-agent-ide",
    binary: "pi",
    packages: [
      { role: "agent", name: "@earendil-works/pi-coding-agent", versionInput: "agentVersion" },
      { role: "extension", name: "pi-agent-ide", versionInput: "harnessVersion" },
    ],
    providers: ["openai-codex"],
    credentialSchemas: {
      "openai-codex": {
        required: ["type", "access", "refresh", "expires", "accountId"],
        allowed: ["type", "access", "refresh", "expires", "accountId"],
        type: "oauth",
      },
    },
  },
});

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label}: expected object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(`${label}: expected fields ${expected.join(", ")}; got ${actual.join(", ")}`);
}

function exactVersion(value, label) {
  if (typeof value !== "string" || !EXACT_VERSION.test(value))
    throw Error(`${label}: an exact semantic version is required`);
  return value;
}

function validateInput(input) {
  const adapter = OFFICIAL_ADAPTERS[input?.adapter];
  if (!adapter) throw Error(`Unknown official adapter: ${input?.adapter}`);
  const fields = ["adapter", "agentVersion", "provider", "model", "reasoning"];
  if (input.adapter === "pi-agent-ide") fields.push("harnessVersion");
  exactKeys(input, fields, "official input");
  exactVersion(input.agentVersion, "agentVersion");
  if (input.harnessVersion !== undefined) exactVersion(input.harnessVersion, "harnessVersion");
  if (!adapter.providers.includes(input.provider))
    throw Error(`Unsupported provider: ${input.provider}`);
  if (!MODEL.test(input.model) || !input.model.startsWith(`${input.provider}/`))
    throw Error("model: exact provider-qualified model id required");
  if (!["off", "low", "medium", "high", "max"].includes(input.reasoning))
    throw Error(`Unsupported reasoning level: ${input.reasoning}`);
  return adapter;
}

async function npmPackage(name, version, fetchImpl) {
  const url = `${OFFICIAL_REGISTRY_URL}/${encodeURIComponent(name)}/${version}`;
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok)
    throw Error(`npm package resolution failed: ${name}@${version} (${response.status})`);
  const metadata = await response.json();
  if (metadata.name !== name || metadata.version !== version)
    throw Error(`npm package identity mismatch: ${name}@${version}`);
  if (
    typeof metadata.dist?.integrity !== "string" ||
    !metadata.dist.integrity.startsWith("sha512-")
  )
    throw Error(`npm package has no sha512 integrity: ${name}@${version}`);
  const tarball = new URL(metadata.dist.tarball);
  if (tarball.protocol !== "https:" || tarball.hostname !== "registry.npmjs.org")
    throw Error(`npm package has forbidden tarball origin: ${name}@${version}`);
  const dependencies = metadata.dependencies ?? {};
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
    throw Error(`npm package has invalid dependencies: ${name}@${version}`);
  return {
    role: null,
    name,
    version,
    integrity: metadata.dist.integrity,
    tarball: tarball.href,
    declaredDependencyFingerprint: createHash("sha256")
      .update(canonicalIdentityJson(dependencies))
      .digest("hex"),
  };
}

/** Resolve caller data to an immutable, declarative execution plan before inference starts. */
export async function resolveOfficialPlan(input, options = {}) {
  const adapter = validateInput(input);
  const fetchImpl = options.fetch ?? fetch;
  const packages = [];
  for (const recipe of adapter.packages) {
    const resolved = await npmPackage(recipe.name, input[recipe.versionInput], fetchImpl);
    packages.push({ ...resolved, role: recipe.role });
  }
  const identity = {
    adapter: input.adapter,
    agentFamily: adapter.agentFamily,
    harnessFamily: adapter.harnessFamily,
    provider: input.provider,
    model: input.model,
    reasoning: input.reasoning,
    packages,
  };
  return {
    schemaVersion: 1,
    ...identity,
    credential: {
      provider: input.provider,
      fields: adapter.credentialSchemas[input.provider].allowed,
    },
    planHash: createHash("sha256").update(canonicalIdentityJson(identity)).digest("hex"),
  };
}

/** Copy only the selected provider credential and reject embedded runtime configuration. */
export function selectOfficialCredential(store, plan) {
  if (!store || typeof store !== "object" || Array.isArray(store))
    throw Error("credential store: expected object");
  const schema = OFFICIAL_ADAPTERS[plan.adapter]?.credentialSchemas[plan.provider];
  if (!schema) throw Error("credential schema does not match execution plan");
  const credential = store[plan.provider];
  exactKeys(credential, schema.allowed, `${plan.provider} credential`);
  for (const field of schema.required)
    if (credential[field] === undefined || credential[field] === null || credential[field] === "")
      throw Error(`${plan.provider} credential: missing ${field}`);
  if (credential.type !== schema.type) throw Error(`${plan.provider} credential: unsupported type`);
  return {
    [plan.provider]: Object.fromEntries(schema.allowed.map((field) => [field, credential[field]])),
  };
}
