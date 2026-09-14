#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Hash an API key before it enters persistent account storage. */
export function hashApiKey(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** Register an owner and return the new API key exactly once. */
export async function createBenchmarkAccount(registryFile, ownerId) {
  if (!OWNER.test(ownerId))
    throw Error("Owner ID must use letters, digits, dot, underscore, or dash");
  let registry = { schemaVersion: 1, accounts: [] };
  try {
    registry = JSON.parse(await readFile(registryFile, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.accounts))
    throw Error("Invalid account registry");
  if (registry.accounts.some((account) => account.ownerId === ownerId))
    throw Error(`Owner already exists: ${ownerId}`);
  const apiKey = `pibe_${randomBytes(24).toString("base64url")}`;
  registry.accounts.push({ ownerId, keyHash: hashApiKey(apiKey), trust: ["self-reported"] });
  await mkdir(path.dirname(path.resolve(registryFile)), { recursive: true });
  await writeFile(registryFile, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
  return apiKey;
}

/** Load the hashed API-key registry used by the ingestion service. */
export async function loadBenchmarkAccounts(registryFile) {
  const registry = JSON.parse(await readFile(registryFile, "utf8"));
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.accounts))
    throw Error("Invalid account registry");
  return Object.fromEntries(
    registry.accounts.map((account) => [
      account.keyHash,
      { ownerId: account.ownerId, trust: account.trust },
    ]),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [registryFile, ownerId] = process.argv.slice(2);
  if (!registryFile || !ownerId) throw Error("Usage: benchmark-accounts.mjs REGISTRY OWNER");
  console.log(await createBenchmarkAccount(registryFile, ownerId));
}
