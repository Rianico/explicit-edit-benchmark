#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { adapterDefinition } from "./adapter-registry.mjs";
import { dshCredentialDocument } from "./export-pi-oauth-to-dsh.mjs";

const OMP_API_KEY_ENV = Object.freeze({
  deepseek: "DEEPSEEK_API_KEY",
  zai: "ZAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
});
async function privateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return file;
}

/**
 * Turn one resolved plan and one selected Pi OAuth credential into trusted prepare-benchmark
 * arguments. This is shared execution setup: callers choose an adapter, never commands or routes.
 */
export async function prepareExecution({ plan, credentialStore, runtime, directory }) {
  const adapter = adapterDefinition(plan.adapter);
  const credential = credentialStore[plan.provider];
  const cliModel = plan.model.slice(plan.model.indexOf("/") + 1);
  const command = path.join(runtime, "node_modules", ".bin", adapter.binary);
  const args = [
    "--harness",
    plan.adapter,
    "--model",
    plan.model,
    "--thinking",
    plan.reasoning,
    "--command",
    command,
    "--runtime",
    runtime,
  ];

  switch (adapter.credential) {
    case "pi": {
      const auth = await privateJson(path.join(directory, "pi-auth.json"), credentialStore);
      args.push("--auth-file", auth);
      if (adapter.extensionPackage) {
        args.push(
          "--ide-package",
          path.join(runtime, "node_modules", adapter.extensionPackage),
          "--harness-version",
          plan.packages.find(({ role }) => role === "extension").version,
        );
      }
      break;
    }
    case "codex": {
      const auth = await privateJson(path.join(directory, "codex-auth.json"), {
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          id_token: credential.access,
          access_token: credential.access,
          refresh_token: credential.refresh,
          account_id: credential.accountId,
        },
        last_refresh: new Date().toISOString(),
      });
      args[args.indexOf(plan.model)] = cliModel;
      args.push("--auth-file", auth);
      break;
    }
    case "opencode": {
      const auth = await privateJson(path.join(directory, "opencode-auth.json"), {
        openai: credential,
      });
      args[args.indexOf(plan.model)] = `openai/${cliModel}`;
      args.push("--auth-file", auth);
      break;
    }
    case "omp": {
      const bun = path.join(runtime, "node_modules", "@oven", "bun-linux-x64", "bin", "bun");
      const bunLink = path.join(runtime, "node_modules", ".bin", "bun");
      await symlink(bun, bunLink).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      const environment = {
        PATH: `${path.join(runtime, "node_modules", ".bin")}:/usr/local/bin:/usr/bin:/bin`,
      };
      if (credential.type === "api_key") {
        const apiKeyEnv = OMP_API_KEY_ENV[plan.provider];
        if (!apiKeyEnv) throw Error(`Oh My Pi has no API-key route for ${plan.provider}`);
        environment[apiKeyEnv] = credential.key;
      } else {
        const ompHome = path.join(directory, "omp");
        const imported = await privateJson(path.join(directory, "omp-import.json"), {
          type: "codex",
          access_token: credential.access,
          refresh_token: credential.refresh,
          account_id: credential.accountId,
          expired: new Date(credential.expires).toISOString(),
        });
        execFileSync(command, ["auth-broker", "import", imported], {
          env: {
            ...process.env,
            PATH: `${path.join(runtime, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
            PI_CODING_AGENT_DIR: ompHome,
          },
          stdio: ["ignore", "ignore", "inherit"],
        });
        await rm(imported, { force: true });
        const database = path.join(ompHome, "agent.db");
        await chmod(database, 0o600);
        args.push("--auth-file", database);
      }
      const envFile = await privateJson(path.join(directory, "omp-env.json"), environment);
      args.push("--env-file", envFile);
      break;
    }
    case "copilot": {
      const envFile = await privateJson(path.join(directory, "copilot-env.json"), {
        OPENAI_CODEX_ACCESS_TOKEN: credential.access,
        OPENAI_CODEX_HEADERS: JSON.stringify({ "ChatGPT-Account-Id": credential.accountId }),
      });
      const providerFile = await privateJson(path.join(directory, "copilot-provider.json"), {
        id: "openai-codex",
        transport: "direct-responses",
        apiKeyEnv: "OPENAI_CODEX_ACCESS_TOKEN",
        endpoints: { responses: "https://chatgpt.com/backend-api/codex" },
        copilotWireApi: "responses",
        copilotCredentialType: "bearer",
        copilotHeadersEnv: "OPENAI_CODEX_HEADERS",
        copilotReasoningEffort: true,
      });
      args[args.indexOf(plan.model)] = cliModel;
      args.push("--provider-file", providerFile, "--env-file", envFile);
      break;
    }
    case "dsh": {
      const auth = await privateJson(
        path.join(directory, "dsh-credentials.json"),
        dshCredentialDocument(credentialStore, plan.provider),
      );
      const providerFile = await privateJson(path.join(directory, "dsh-provider.json"), {
        id: plan.provider,
        catalog: true,
      });
      args[args.indexOf(plan.model)] = cliModel;
      args.push("--auth-file", auth, "--provider-file", providerFile);
      break;
    }
    default: {
      throw Error(`Unsupported credential route: ${adapter.credential}`);
    }
  }
  return args;
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      credential: { type: "string" },
      runtime: { type: "string" },
      directory: { type: "string" },
      output: { type: "string" },
    },
  });
  if (!values.plan || !values.credential || !values.runtime || !values.directory || !values.output)
    throw Error(
      "Usage: prepare-execution --plan FILE --credential FILE --runtime DIR --directory DIR --output FILE",
    );
  const args = await prepareExecution({
    plan: JSON.parse(await readFile(values.plan, "utf8")),
    credentialStore: JSON.parse(await readFile(values.credential, "utf8")),
    runtime: path.resolve(values.runtime),
    directory: path.resolve(values.directory),
  });
  await privateJson(path.resolve(values.output), args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
