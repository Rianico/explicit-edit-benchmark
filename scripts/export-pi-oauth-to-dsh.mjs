#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Convert one Pi OAuth credential into DeepSeek Harness's versioned credential record. */
export function dshCredentialDocument(auth, provider) {
  if (!/^[a-z0-9-]+$/u.test(provider)) throw Error("Invalid provider id");
  const credential = auth?.[provider];
  if (
    credential?.type !== "oauth" ||
    typeof credential.access !== "string" ||
    typeof credential.refresh !== "string" ||
    typeof credential.expires !== "number"
  ) {
    throw Error(`Pi has no transferable OAuth credential for ${provider}`);
  }
  return {
    version: 1,
    records: {
      [`llm-pi-ai/${provider}`]: {
        kind: "grant",
        payload: credential,
      },
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "auth-file": { type: "string" },
      provider: { type: "string" },
      output: { type: "string" },
    },
  });
  if (!values["auth-file"] || !values.provider || !values.output) {
    throw Error("Usage: export-pi-oauth-to-dsh --auth-file FILE --provider ID --output FILE");
  }
  const auth = JSON.parse(await readFile(path.resolve(values["auth-file"]), "utf8"));
  const document = dshCredentialDocument(auth, values.provider);
  const output = path.resolve(values.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    `Copied ${values.provider} OAuth credential into ${values.output}; no secret was printed.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
