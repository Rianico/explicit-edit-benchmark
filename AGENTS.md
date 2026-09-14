# Working in this repository

This is the Explicit Edit Benchmark: 226 deterministic exact-edit tasks with a byte-exact verifier,
a runner that keeps runs comparable, adapters for several agent CLIs, and the flow that publishes an
accepted result to a Hugging Face Dataset.

You do not need to be told which file to open. When a request matches a skill below, load that skill
and follow it.

## Skills

| Skill                           | Use it when the request is                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `configure-codex-account`       | Run Codex on a ChatGPT subscription, an API-key route, or a Chinese provider                        |
| `configure-copilot-account`     | Run Copilot on its own GitHub account, a provider key, or an OAuth-only plan through a local bridge |
| `add-benchmark-harness`         | Add an adapter for another agent CLI                                                                |
| `publish-benchmark-observation` | Run an observation and publish it to the Dataset                                                    |
| `review-benchmark-candidate`    | Review, validate, and accept a contributed result                                                   |

## One way to run the benchmark is to be the runner

Start an agent in this repository and ask for a published result. It reads the skills, prepares the
adapter, runs the exact tasks, exports and validates the bundle, and opens the Dataset pull request.
Nothing else has to be arranged first. The same flow by hand is one command on the same configuration.

A full observation spends real money on model calls. Run one task first (`--smoke`) unless the person
asked for the whole set.

## Rules that keep the published data honest

- Never edit an exported row to make a result look better or to fix a name. Fix the source and rerun,
  or migrate the bundle through the acceptance path, which recomputes every hash.
- Never commit a credential. `provider.json`, `private-env.json`, `benchmark.config.ts` and
  `submission-metadata.json` are ignored by git for that reason; keys belong in a private env file.
- Keep prompts, model prose, raw commands, command output, sessions, workspaces and `results/` out of
  git. They are not part of an observation.
- Publish only facts the harness reported. A metric nobody observed stays `null`; it never becomes
  zero, and a version nobody checked is never guessed.
- Identities live in `src/suites/explicit-edit/version.ts`. Do not spell them out anywhere else; a
  test fails when a literal appears outside that file.
- A harness that starts a server per trial (the bb example) runs one trial at a time; running several
  makes the machine the thing under test.

## Before you commit

```sh
npm run check
```

Formatting, lint, type checks, unit and integration tests, and a deterministic sandbox trial. It makes
no paid model calls, and it is the same command CI runs.

## Where the depth is

`docs/running.md` covers adapters, provider routes, mounts and credentials.
`docs/benchmark-automation.md` covers the config API, the normalized data format and the Dataset
views. `docs/methodology.md` explains the tasks, the scores and recovery, and `docs/architecture.md`
says which layer owns which fact. The README lists all of them with one line each.
