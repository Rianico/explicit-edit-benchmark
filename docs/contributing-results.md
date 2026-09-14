# Share a result

Submit a run with your own Hugging Face account. You never need a maintainer token.

Setup, requirements, and the command itself are in the [README](../README.md). This document covers what happens while the command runs, what you are responsible for, and how a maintainer accepts the result.

## What happens while it runs

| Phase       | What it does                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prepare** | Builds a temporary configuration for the agent, model, and reasoning level you picked, then checks the agent binary and version.                                       |
| **Check**   | Confirms the Hugging Face login before anything is spent.                                                                                                              |
| **Smoke**   | Runs one exact task for every selected configuration and compares the resulting files byte for byte.                                                                   |
| **Run**     | Runs all 226 tasks, with five Oracle recovery attempts and a 120-second timeout per round.                                                                             |
| **Submit**  | Exports the bundle, validates it, builds safe metadata, and opens a pull request on the [Dataset](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark). |

A failed smoke stops the command before the full run. That is the point of the phase: a wrong model, a stale binary, or a broken login costs you one task instead of 226.

You never run the smoke task yourself, and you never set `ready: true`. That flag only gates the lower-level `npm run benchmark -- run`.

## What you are responsible for

- **Keep every failure, timeout, and recovery attempt.** They are observations, not noise to hide.
- **Never edit exported rows** to improve a result. If the identity is wrong, fix the configuration and rerun.
- **Send the pull request URL to the maintainers.** The command prints it when it finishes.
- **Paid model calls are on your account.** The smoke phase is cheap; the full run is not.

The pull request holds benchmark facts only. The [README](../README.md#what-gets-published) lists exactly what is published and what never leaves your machine.

## Maintainer acceptance

```sh
HF_TOKEN=hf_... npm run benchmark -- accept \
  --repository alexshpunt/explicit-edit-benchmark \
  --candidate PR_NUMBER_OR_REF
```

Acceptance validates the candidate, appends it to `source/accepted/`, and rebuilds every generated view in one parent-checked commit. [Benchmark automation and public data](benchmark-automation.md) describes the data format, the generated views, and the acceptance internals.
