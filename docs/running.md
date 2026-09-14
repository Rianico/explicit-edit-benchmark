# Configuration guide

This guide covers what sits behind `npm run benchmark:submit`: models, reasoning levels, provider routes, credential files, and custom adapters.

## The normal path

Install and log in to your agent CLI, then pass the agent, the exact model, and the reasoning level:

```sh
npm run benchmark:submit -- --harness codex-cli-default --model PROVIDER/MODEL --thinking high --concurrency 10
```

`--concurrency` is how many tasks run at once. It changes how long the run takes, not the result.

The command writes a temporary configuration into the system temp folder and deletes it when it finishes, so you never prepare or commit a config file for a ready adapter.

`--harness` takes the published harness family: `pi-default`, `pi-agent-ide`, `codex-cli-default`, `opencode-default`, `oh-my-pi-default`, `github-copilot-cli-default`, `dsh-standard`, or `dsh-code`.

| Adapter                      | Binary     |
| ---------------------------- | ---------- |
| `pi-default`                 | `pi`       |
| `pi-agent-ide`               | `pi`       |
| `codex-cli-default`          | `codex`    |
| `opencode-default`           | `opencode` |
| `oh-my-pi-default`           | `omp`      |
| `github-copilot-cli-default` | `copilot`  |
| `dsh-standard`               | `dsh`      |
| `dsh-code`                   | `dsh`      |

The adapter name is the published family, so the accepted result is grouped under the name you ran. Pass `--command` when the binary is not on `PATH` under that name.

Install your agent yourself and log in the way that agent expects. The benchmark never installs or updates an agent, and it never borrows someone else's credentials.

## Models and reasoning

| Adapter                      | `--model` argument   | Authentication                       |
| ---------------------------- | -------------------- | ------------------------------------ |
| `pi-default`                 | Pi provider/model id | Pi `auth.json` or an environment key |
| `pi-agent-ide`               | Pi provider/model id | Pi `auth.json` or an environment key |
| `codex-cli-default`          | Provider model id    | Responses provider key               |
| `opencode-default`           | Provider model id    | OpenAI-compatible provider key       |
| `oh-my-pi-default`           | Provider model id    | OpenAI-compatible provider key       |
| `github-copilot-cli-default` | Provider model id    | Copilot BYOK provider key            |
| `dsh-standard`               | Provider model id    | DeepSeek Harness custom-provider key |
| `dsh-code`                   | Provider model id    | DeepSeek Harness custom-provider key |

The model and reasoning strings go straight to the CLI, so what works depends on the installed agent and your account. If a setting is not supported, the smoke task must fail. It must never quietly run a different model.

## Provider routes and credential files

Agents that read Pi's `auth.json` need nothing extra. Agents that talk to an API key need a local route:

```sh
npm run benchmark:submit -- --harness codex-cli-default --model PROVIDER/MODEL --thinking low \
  --provider-file provider.json \
  --env-file private-env.json
```

`provider.json` holds routing metadata: a provider id, the environment variable name, and the endpoint for each protocol. It holds no key. `private-env.json` holds the key itself and stays on your machine. Keep both files private.

Each adapter has its own quirks:

- **Codex** writes its own `config.toml` and needs a Responses endpoint.
- **Copilot** uses the current `COPILOT_PROVIDER_*` variables. BYOK runs are labelled `direct-completions`.
- **DeepSeek Harness** needs a provider route: `dsh-standard` and `dsh-code` call a completions or catalog endpoint, so `--provider-file` is required. It writes its own `settings.yaml`. `dsh-standard` uses native tools, `dsh-code` uses PTC Code Mode. Both turn telemetry off and record the full SDK session event stream, which is what keeps same-session recovery working.
- **Pi Agent IDE** loads the published `pi-agent-ide` npm package, so install it and pass `--ide-package DIRECTORY` pointing at the installed package. The adapter reads the extension entry and version from that package and mounts it read-only. `--harness-version` must equal the installed package version, otherwise the harness version would be confused with the Pi agent version.

## Run a harness on your own subscription

There are three ways to pay for the model behind a run, and all three publish the same kind of
evidence. Pick by what your account gives you.

### Copilot on its own GitHub subscription

The GitHub Copilot CLI already knows your account, so it needs no routing file. It does need its
sign-in copied into the sandbox:

```sh
npm run benchmark:submit -- --harness github-copilot-cli-default --model gpt-5.6-luna --thinking high \
  --auth-file "$HOME/.copilot/config.json"
```

Install the CLI and sign in the way it expects (`copilot`, then its login flow). `--auth-file` copies
that one file into the sandbox; nothing else from your home directory is mounted. The adapter runs
the CLI with `--no-auto-update`, without built-in MCP servers, and without custom instructions, so
the measurement stays with the harness rather than with whatever your global configuration adds.

### Copilot with your own provider key (BYOK)

This is how a subscription or a plan that only speaks the OpenAI wire protocol gets measured: point
the Copilot CLI at your endpoint and give it your key. Copy the two examples and fill them in:

```sh
cp examples/provider.example.json provider.json
cp examples/private-env.example.json private-env.json
npm run benchmark:submit -- --harness github-copilot-cli-default --model PROVIDER/MODEL --thinking high \
  --provider-file provider.json \
  --env-file private-env.json
```

`provider.json` holds routing metadata: `id`, `apiKeyEnv`, and an endpoint per protocol. It holds no
key. `private-env.json` holds the key itself and stays on your machine. Keep both files private:
the prepared configuration carries the values from the environment file, and the repository ignores
`provider.json`, `private-env.json`, and `benchmark.config.ts` for exactly that reason.

Copilot-specific fields, all optional except the endpoint:

| Field                                              | Effect                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `copilotWireApi`                                   | `completions` (default) or `responses`. It picks the endpoint and labels the transport      |
| `copilotModelId`                                   | The id sent to the provider when it differs from the benchmark's `--model`                  |
| `copilotReasoningEffort`                           | Add `--effort <thinking>` when the provider accepts reasoning effort                        |
| `copilotMaxPromptTokens`, `copilotMaxOutputTokens` | Pass the provider's token limits through                                                    |
| `copilotHeadersEnv`                                | Name of an environment variable holding extra request headers, when the provider needs them |

The adapter always runs Copilot with `COPILOT_OFFLINE=true`, so it cannot fall back to GitHub while
you measure your own provider. A BYOK run is published as `direct-completions` (or
`direct-responses`), which is how it stays distinguishable from the same CLI on its own account.

### A plan that only speaks OAuth

Some plans (an OpenAI subscription, for example) hand you a login instead of an API key. The adapter
needs an OpenAI-compatible endpoint and a key, so such a plan has to be fronted by a small local
bridge that turns the OAuth session into that endpoint. This repository does not ship a bridge:
write one, or use one you trust, then treat it like any other BYOK provider — the base URL points at
the bridge, and the key variable holds whatever the bridge expects. Select the wire API your bridge
speaks; a bridge that only forwards partial streaming items will fail the `responses` path, because
the Responses API expects each output item to be complete in the final event.

## Runtime and mounts

The runner does not inherit your whole shell environment.

- `--command` picks the CLI binary. If the binary lives outside `/usr`, pass `--runtime` for its installation directory and dependencies.
- Do not mount your whole home directory, this checkout, or your credentials directory. The model can see everything you mount.
- `--model-file` seeds a custom Pi or OMP model catalog. The benchmark copies seeds into isolated state and leaves your originals alone.
- State is deleted after each chain, so refreshed credentials are never written back.

Raw CLI logs can contain secrets. Never upload them without reading them first.

## Custom adapters and your own config

If you keep your own `benchmark.config.ts`, submit it with `--config`:

```sh
npm run benchmark:submit -- --config benchmark.config.ts
```

A TypeScript config is a trusted module you build from `defineHarness` and `defineBenchmarkConfig`. It can run one model on one harness, a list of pairs, or a full model × harness matrix. Start from [`examples/benchmark.config.ts`](../examples/benchmark.config.ts).

Use this path when your agent is not in the ready adapter list. [Benchmark automation and public data](benchmark-automation.md) describes the adapter contract, and [examples/bb](../examples/bb/benchmark.config.mjs) shows a harness that needs more than a command.

## Development commands

The lower-level commands are still there for adapter work and maintainer debugging:

```sh
npm run benchmark -- init
npm run benchmark -- check --config benchmark.config.ts
npm run benchmark -- run --config benchmark.config.ts \
  --oracle-recoveries 5 --concurrency 10 --timeout-seconds 120 --run-id my-run
npm run benchmark -- export results/my-run
npm run benchmark -- inspect results/my-run/normalized
npm run benchmark -- report results/my-run/normalized
```

Without `--task` the runner takes all 226 tasks. `--task ID` runs one, and `--task-manifest FILE` runs a saved subset; you cannot combine those two. `--results DIR` moves the output root, and `--retry-failures N` starts fresh trials instead of recovering in the same session. `npm run bench:run -- --help` prints the full list.

A finished queue does not mean every task passed. Read `summary.json` before you trust a run.

`bench:prepare` writes a trusted local adapter JSON into the system temp folder for these runs, and a trial keeps its sandbox state there too. The adapter file is executable local configuration, not a public submission.

`npm run check` runs formatting, linting, types, and the deterministic sandbox without any paid model calls. It does not replace a real smoke run.
