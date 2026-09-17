#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubmission } from "./benchmark-submission.mjs";

const TABLES = [
  "profiles.jsonl",
  "configurations.jsonl",
  "trials.jsonl",
  "rounds.jsonl",
  "tool-calls.jsonl",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function replaceStrings(value, from, to) {
  if (typeof value === "string") return value.includes(from) ? value.replaceAll(from, to) : value;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, from, to)]),
    );
  return value;
}

function parseRows(content) {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function serializeRows(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

/** Replace identity values and preserve configuration/profile referential integrity. */
export function migrateIdentityRows(rows, from, to) {
  const migrated = Object.fromEntries(
    Object.entries(rows).map(([name, values]) => [
      name,
      values.map((row) => replaceStrings(row, from, to)),
    ]),
  );
  const hashMap = new Map();
  for (const configuration of migrated["configurations.jsonl"]) {
    const oldHash = configuration.configurationHash;
    const { configurationHash: _configurationHash, ...recipe } = configuration;
    configuration.configurationHash = sha256(JSON.stringify(recipe));
    hashMap.set(oldHash, configuration.configurationHash);
  }
  for (const profile of migrated["profiles.jsonl"]) {
    if (hashMap.has(profile.configurationHash))
      profile.configurationHash = hashMap.get(profile.configurationHash);
  }
  return migrated;
}
/** Migrate one literal identity throughout canonical accepted bundles and recalculate every derived identity. */
export async function migrateDatasetIdentity(storeDirectory, { from, to }) {
  if (!from || !to || from === to) throw Error("Distinct non-empty from/to values are required");
  const root = path.resolve(storeDirectory);
  const indexPath = path.join(root, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const migrated = [];

  for (const [position, metadata] of index.submissions.entries()) {
    const oldDirectory = path.join(root, "accepted", metadata.submissionId);
    const contents = Object.fromEntries(
      await Promise.all(
        TABLES.map(async (name) => [name, await readFile(path.join(oldDirectory, name), "utf8")]),
      ),
    );
    if (![JSON.stringify(metadata), ...Object.values(contents)].some((text) => text.includes(from)))
      continue;

    const rows = migrateIdentityRows(
      Object.fromEntries(TABLES.map((name) => [name, parseRows(contents[name])])),
      from,
      to,
    );

    for (const name of TABLES) contents[name] = serializeRows(rows[name]);
    const manifest = replaceStrings(
      JSON.parse(await readFile(path.join(oldDirectory, "manifest.json"), "utf8")),
      from,
      to,
    );
    for (const name of TABLES)
      manifest.files[name] = {
        bytes: Buffer.byteLength(contents[name]),
        sha256: sha256(contents[name]),
      };
    await Promise.all([
      writeFile(path.join(oldDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
      ...TABLES.map((name) => writeFile(path.join(oldDirectory, name), contents[name])),
    ]);

    const replacedMetadata = replaceStrings(metadata, from, to);
    const submission = await buildSubmission(oldDirectory, {
      clientRunId: replacedMetadata.clientRunId,
      purpose: replacedMetadata.purpose,
      definitions: replacedMetadata.definitions,
    });
    const contentHash = sha256(
      stable({ definitions: submission.definitions, bundle: submission.bundle }),
    );
    const nextMetadata = {
      ...replacedMetadata,
      submissionId: contentHash,
      contentHash,
    };
    await writeFile(
      path.join(oldDirectory, "submission.json"),
      `${JSON.stringify(nextMetadata, null, 2)}\n`,
    );
    const newDirectory = path.join(root, "accepted", contentHash);
    await rename(oldDirectory, newDirectory);
    index.submissions[position] = nextMetadata;
    migrated.push({ previousSubmissionId: metadata.submissionId, submissionId: contentHash });
  }

  if (!migrated.length) throw Error(`No canonical source value contained ${JSON.stringify(from)}`);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return { migrated };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const storeDirectory = process.argv[2];
  if (!storeDirectory) throw Error("Usage: migrate-dataset-identity STORE --from OLD --to NEW");
  console.log(
    JSON.stringify(
      await migrateDatasetIdentity(storeDirectory, { from: option("from"), to: option("to") }),
      null,
      2,
    ),
  );
}
