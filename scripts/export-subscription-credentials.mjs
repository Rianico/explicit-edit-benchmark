#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

/**
 * Turn the subscription credential that Pi already holds into the private snapshots other CLIs
 * need, so a run on your own plan does not require a second login.
 *
 *   node scripts/export-subscription-credentials.mjs [--provider openai-codex] [--directory DIR] [--omp BINARY]
 *
 * It reads `<Pi home>/auth.json`, never refreshes it, and never changes it. What it writes:
 *
 *   <directory>/codex/auth.json   a Codex home for the OAuth bridge and for `codex` itself
 *   <directory>/omp/agent.db      an Oh My Pi store, ready for `--auth-file` (only with --omp)
 *
 * The snapshots hold an access token and no refresh token on purpose: they can only read, they
 * expire with the subscription session, and a leaked file cannot mint a new session. Nothing is
 * printed but paths, and every file is written 0600 inside a 0700 directory.
 *
 * Re-run it after logging in or refreshing in Pi. It refuses to write a snapshot that expires
 * within the hour, because a run would fail in the middle.
 */

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "openai-codex" },
    directory: { type: "string" },
    omp: { type: "string" },
    "pi-home": { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: node scripts/export-subscription-credentials.mjs [--provider openai-codex] [--directory DIR] [--omp BINARY] [--pi-home DIR]. Writes private access-only snapshots for the CLIs that need them; no secret is printed.",
  );
  process.exit(0);
}

const piHome = path.resolve(values["pi-home"] ?? path.join(os.homedir(), ".pi/agent"));
const directory = path.resolve(
  values.directory ?? path.join(os.homedir(), ".local/share/explicit-edit-benchmark/subscription"),
);
const auth = JSON.parse(await readFile(path.join(piHome, "auth.json"), "utf8"))[values.provider];
if (!auth?.access || !auth?.accountId || !auth?.expires)
  throw Error(`${values.provider} in ${piHome}/auth.json has no access credential`);

const remainingMinutes = Math.round((auth.expires - Date.now()) / 60_000);
if (auth.expires < Date.now() + 3_600_000)
  throw Error(
    `the ${values.provider} credential expires in ${remainingMinutes} minutes; log in or refresh it in Pi first`,
  );

/** Write one snapshot with owner-only permissions, inside an owner-only directory. */
async function snapshot(relative, content) {
  const destination = path.join(directory, relative);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(destination), 0o700);
  await writeFile(destination, JSON.stringify(content, null, 2) + "\n", { mode: 0o600 });
  return destination;
}

const codexHome = await snapshot("codex/auth.json", {
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: {
    id_token: auth.access,
    access_token: auth.access,
    refresh_token: "",
    account_id: auth.accountId,
  },
  last_refresh: new Date().toISOString(),
});
console.log(`codex home: ${path.dirname(codexHome)}  (use it as CODEX_HOME for the bridge)`);
console.log(`credential valid for about ${remainingMinutes} minutes`);

if (values.omp) {
  const omp = path.resolve(values.omp);
  const ompHome = path.join(directory, "omp");
  const importFile = path.join(directory, "omp-import.json");
  await snapshot("omp-import.json", {
    type: "codex",
    access_token: auth.access,
    // Oh My Pi rejects an empty refresh field; this value cannot be exchanged for anything.
    refresh_token: "disabled-access-only-snapshot",
    account_id: auth.accountId,
    expired: new Date(auth.expires).toISOString(),
  });
  try {
    execFileSync(omp, ["auth-broker", "import", importFile], {
      env: { ...process.env, PI_CODING_AGENT_DIR: ompHome },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    await rm(importFile, { force: true });
  }
  const database = path.join(ompHome, "agent.db");
  await chmod(database, 0o600);
  console.log(`oh my pi store: ${database}  (use it as --auth-file)`);
}
