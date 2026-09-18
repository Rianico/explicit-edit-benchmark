# Methodology

Explicit Edit has 226 generated mechanical editing tasks.

`npm run bench:list` prints the task IDs, categories, and fixture hashes. Generation is deterministic, and both the inputs and the expected outputs stay in the parent verifier. The model sees the prompt and the input workspace, never the expected tree.

## Scores

- **First exact**: the first round exits successfully within its deadline and the whole file tree matches the expected bytes.
- **Final exact**: the same thing, but after the allowed Oracle recoveries.
- **EOF-normalized**: a separate diagnostic score that tolerates only complete trailing LF or CRLF sequences. Blank lines inside the file, spaces, and invisible characters still count. A failed execution stays a failure.

A missing file, an extra file, a symlink, a change to content that should not have moved, or a timeout all fail exact validation. The verifier compares file bytes. It does not care whether a test compiles or whether the behavior is equivalent.

### Scoring version 2

The public score keeps first-attempt success more important without discarding useful recovery:

`quality = 0.75 × first exact + 0.25 × final exact`

Repeated observations first form one mean for each user-visible configuration and task. Full and partial runs with the same model, agent, harness version, provider, transport, and reasoning level refine that cell and increase its observation count. Historical configuration hashes remain provenance and do not split the score. Compatible configurations then receive equal weight within each task, and tasks receive equal weight in the final quality score.

Coverage is the share of the declared task set observed at least once. Partial runs are valid and remain visible. The conservative leaderboard score is `quality × coverage`, while quality and coverage are also published separately. This prevents a perfect one-task run from looking like a complete benchmark.

Owner, display labels, run IDs, timestamps, partial task selections, and scheduling concurrency do not create new experimental cells. Different benchmark contracts or verifier identities remain separate. Task-set and run-policy identities stay attached as provenance. Raw observations remain in the Dataset when scoring rules change.

Explorer family scores use a different rollup because they summarize configurations rather than tasks. Primary model rows identify a model route: model family plus provider. A provider-agnostic model-family summary remains available as a secondary view. Each model route, model family, agent, harness, or reasoning family is scored by the median Score of its complete eligible configurations. Partial and quarantined configurations remain visible but do not enter the family median. The generated views also publish the mean, quartiles, range, and number of complete configurations so readers can see the spread behind the headline value. Task-family slices use only configurations whose full benchmark evidence is complete.

A configuration is quarantined from rankings and badges after at least 50 trials when at least 20% of its trials have a confirmed provider-attributable terminal failure. Accepted evidence is never removed. Generic timeouts, process exits, and error prose do not count. Historical schema-v1 observations have no provider-failure attribution and are never inferred retroactively. Built-in adapters currently publish `null` until an adapter exposes a documented machine-readable cause.

## Recovery

`--oracle-recoveries N` carries on in the same session and workspace after a failed check. N counts extra rounds, not total attempts, and the chain stops at the first exact pass. Feedback comes from the verifier, so a recovery round is not another independent trial.

`--retry-failures N` does the opposite: it starts fresh trials. The two modes cannot be combined. Zero means the initial round only.

Keep first and final scores apart. A final EOF-normalized score describes an experiment that stopped on exact success, not one that stopped on a normalized success. Adaptive retries cannot tell you the unconditional pass probability.

## Isolation and tools

Bubblewrap on Linux exposes the input workspace, the per-chain state, and the read-only runtimes you asked for. The verifier is not mounted. Native tools, shell commands included, are available, and command approvals are bypassed inside this outer sandbox. Network access stays open for inference. This is not a network firewall.

Every adapter uses its own CLI and its own tool surface, so check the installed version and the effective model and reasoning level before a full run. A configured model name is not proof of the model that ran. An unsupported version or provider needs a fresh smoke check, never a silent fallback.

## Interpreting the numbers

The retained report is one run of six harnesses with a frozen model and settings. It is not a stable ranking, and it does not prove that one harness improves general reasoning. The suite grew alongside the IDE, and repeated mechanical patterns can favor a script over native tools. Say which one you mean when you discuss editing ergonomics.

Process time includes harness overhead and recovery, and both provider load and machine differences move it around. A missing tool metric is unknown, not zero. Any future comparison has to carry its suite, subset, model, reasoning, version, and recovery settings with it. Recovery rounds are not independent runs.
