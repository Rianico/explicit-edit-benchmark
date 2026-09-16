import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

/** Serialize identity input without depending on object insertion order. */
export function canonicalIdentityJson(value) {
  return JSON.stringify(canonical(value));
}

/** Identify one producer invocation while keeping measured configurations separate. */
export function executionIdentity({
  repository,
  runId,
  producerAttempt,
  invocation,
  configurationHashes,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw Error("Invalid execution repository");
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw Error("Invalid GitHub run id");
  if (!/^[1-9][0-9]*$/.test(String(producerAttempt))) throw Error("Invalid producer attempt");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(invocation)) throw Error("Invalid invocation id");
  const hashes = [...new Set(configurationHashes)].sort();
  if (!hashes.length || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
    throw Error("Invalid execution configuration hashes");
  const identity = {
    repository,
    runId: String(runId),
    producerAttempt: Number(producerAttempt),
    invocation,
    configurationHashes: hashes,
  };
  return {
    ...identity,
    executionId: createHash("sha256").update(canonicalIdentityJson(identity)).digest("hex"),
  };
}
