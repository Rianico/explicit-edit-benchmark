# Explicit Edit architecture

Explicit Edit keeps three things apart: the benchmark definition, accepted evidence, and generated analysis. Each fact has exactly one home.

## Where each fact lives

| Layer              | Home                                                                                                                                                      | What it owns                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Benchmark core     | This GitHub repository                                                                                                                                    | Tasks, fixtures, instructions, the exact verifier, normalized schema, runner, validation, Score rules, and the commands that publish data |
| Run output         | A contributor's local `results/` directory                                                                                                                | Raw evidence from one execution. Private until reviewed and normalized.                                                                   |
| Accepted evidence  | Hugging Face Dataset [`alexshpunt/explicit-edit-benchmark`](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark), under `source/accepted/` | Reviewed observations and where they came from                                                                                            |
| Generated analysis | The same Hugging Face Dataset                                                                                                                             | Leaderboard, dashboard views, summaries, indexes, and compressed tables, all rebuilt from accepted evidence                               |

The Dataset stores accepted evidence and the generated views. The benchmark calculates those views.

## What this repository owns

The task set is frozen: it changes only when the task bytes or the verifier behavior change.

The repository owns:

- task identity and starting files;
- expected files and byte-exact verification;
- sandbox and run-policy behavior;
- normalized schema v1;
- validation and acceptance rules;
- the canonical Score and aggregation rules;
- the commands that build and publish Dataset views.

It does not store the accepted result corpus.

## Local runs and normalization

A run stays in your local `results/` directory. It can hold sensitive logs, sessions, workspaces, prompts, output, commands, arguments, and credentials, so never upload it.

The exporter turns it into a safe normalized bundle:

```text
manifest.json
profiles.jsonl
configurations.jsonl
trials.jsonl
rounds.jsonl
tool-calls.jsonl
```

`profiles.jsonl` records the agent, model, provider, harness, adapter, transport, reasoning mode, exact versions, and `configurationHash` that were actually observed. `configurations.jsonl` maps that hash to a recipe for reproducing the setup. A recipe holds safe public references and environment variable names, never credentials or local executable state.

Runner, benchmark, task-set, and owner provenance travel separately in the submission metadata. The evidence is taken on trust and can be removed if it turns out to be wrong; there is no trust field to filter on.

## Candidates and accepted evidence

A contributor uses their own Hugging Face account to open a Dataset pull request containing:

```text
candidates/<run-id>/
  manifest.json
  profiles.jsonl
  configurations.jsonl
  trials.jsonl
  rounds.jsonl
  tool-calls.jsonl
  submission.json
```

A candidate is not evidence yet. A maintainer has to review and accept it.

Accepted bundles are kept as they are, with generated tables living elsewhere:

```text
source/accepted/<submission-id>/
  manifest.json
  profiles.jsonl
  configurations.jsonl
  trials.jsonl
  rounds.jsonl
  tool-calls.jsonl
  submission.json
```

`source/index.json` lists the accepted submissions. Links to evidence must point at accepted source data, never at another scoreboard.

## Acceptance and aggregation

Acceptance publishes everything in one parent-checked commit:

1. Download current Dataset `main` and the candidate revision.
2. Validate schema v1, hashes, foreign keys, run identity, safe metadata, task-set identity, and compatibility.
3. Add the reviewed bundle to `source/accepted/`.
4. Rebuild every generated view from all accepted bundles.
5. Commit the evidence and the views together.

The official Score is:

```text
coverage × (0.75 × first exact rate + 0.25 × final exact rate)
```

`scripts/result-aggregation.mjs` defines the Score and the shared aggregation rules. First exact, final exact, EOF-normalized results, recovery, timeouts, duration, cost, and tokens all stay separate facts.

Acceptance generates:

- `leaderboard.json`, the canonical configuration ranking;
- `views.json`, with the precomputed group, task-family, tool-usage, and drill-down views;
- `summary.json`, with observation and efficiency summaries;
- `dataset-index.json`, with run provenance, completeness, and hashes;
- gzip JSONL tables under `data/`.

All of these are projections. Delete them and they rebuild from `source/accepted/`.

## Failures and concurrency

Acceptance is parent-checked. If another commit changes Dataset `main`, the stale attempt fails instead of overwriting it. The maintainer runs acceptance again against the new head.

Publishing the Dataset is retryable, not transactional. The accepted commit holds the evidence, and every generated view can be rebuilt from it later without touching that evidence.

## Related guides

- [Run a benchmark](running.md)
- [Share a result](contributing-results.md)
- [Benchmark automation and public data](benchmark-automation.md)
- [Methodology](methodology.md)
