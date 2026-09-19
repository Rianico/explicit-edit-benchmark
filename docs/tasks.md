# Benchmark tasks

Explicit Edit uses 226 deterministic editing tasks. Each task asks for a fully specified text change. The agent does not need to understand a program, diagnose a bug, or invent a solution. It needs to find the right bytes, make the requested change, and leave everything else alone.

The task generator is the source of truth: [`src/suites/explicit-edit/fixtures.ts`](../src/suites/explicit-edit/fixtures.ts). Language-shaped fixtures live in [`src/suites/explicit-edit/language-fixtures.ts`](../src/suites/explicit-edit/language-fixtures.ts). Run `npm run bench:list` to print every generated task ID, category, scale, language, variant, and fixture hash.

## How a task is built

The generator creates an input workspace, an exact expected workspace, and a prompt that describes the edit. The benchmark gives the agent only the input workspace and prompt. The expected workspace stays with the verifier.

Generation is deterministic. There is no random seed and no sampling. The same benchmark version always produces the same task IDs and bytes. Each fixture also has a SHA-256 hash over its definition, so a changed prompt or file changes the fixture identity.

Every generated workspace contains `untouched.txt`. The prompt says not to edit it, and the verifier checks it like every other file. This catches broad rewrites and tools that change unrelated bytes.

The verifier compares the complete workspace byte for byte. A task fails if the agent changes an unrelated character, line ending, invisible character, or final newline. Missing files, extra files, directories where files should be, and symlinks also fail.

## How task IDs work

Most IDs have this form:

```text
<family>-<scale>[-<language-or-case>]-<variant>
```

For example:

- `replace-all-100-unicode` replaces 100 occurrences in a Unicode-sensitive fixture.
- `language-select-10-python-plain` changes one selected Python entry among 10 similar entries.
- `literal-1-no-final-newline-unicode` changes literal text without adding a final newline.

The scale does not always mean “number of replacements.” Its meaning belongs to the family: occurrences, files, similar entries, surrounding rows, inserted rows, or independent edits.

## Matrix at a glance

Counts include both variants where a family has plain and Unicode twins.

| Family             | Scales or cases                   |   Tasks |
| ------------------ | --------------------------------- | ------: |
| `language-replace` | 10 occurrences                    |      36 |
| `language-select`  | 10 similar entries                |      36 |
| `language-insert`  | 1 inserted entry                  |      36 |
| `unique`           | 10, 100, 1,000 surrounding routes |       6 |
| `replace-all`      | 1, 10, 100, 1,000 occurrences     |       8 |
| `multi-file`       | 1, 10, 100 files                  |       6 |
| `select-one`       | 1, 10, 100, 1,000 similar tests   |       8 |
| `select-subset`    | 10, 100, 1,000 similar tests      |       6 |
| `delete-subset`    | 10, 100, 1,000 similar tests      |       6 |
| `insert-subset`    | 10, 100, 1,000 similar tests      |       6 |
| `distinct-edits`   | 1, 10, 30 files                   |       6 |
| `literal`          | 5 literal cases                   |      10 |
| `unicode-fix`      | 8 lookalike-character cases       |       8 |
| `replace-block`    | 10, 100, 1,000 source rows        |       6 |
| `delete-block`     | 10, 100, 1,000 source rows        |       6 |
| `move-block`       | 10, 100, 1,000 source rows        |       6 |
| `copy-block`       | 10, 100, 1,000 source rows        |       6 |
| `copy-within`      | 10, 100, 1,000 source rows        |       6 |
| `move-between`     | 10, 100, 1,000 source rows        |       6 |
| `insert-block`     | 10, 100, 1,000 surrounding rows   |       6 |
| `insert-payload`   | 10, 100, 1,000 inserted rows      |       6 |
| **Total**          | **21 families**                   | **226** |

## Task clusters

The suite has five broad clusters. They test different ways an exact edit can become difficult.

### Find and replace

These tasks range from one unique match to many matches spread across many files.

| Family           | What the agent must do                                 | Scales                            | What gets harder                                                                                                                 |
| ---------------- | ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `unique`         | Replace one unique value in `settings.ts`.             | 10, 100, 1,000 surrounding routes | The edit stays the same while unrelated context grows.                                                                           |
| `replace-all`    | Replace every occurrence in one file.                  | 1, 10, 100, 1,000 occurrences     | The agent must find and change a growing number of matches without missing one.                                                  |
| `multi-file`     | Replace 1,000 total occurrences inside `cases/`.       | 1, 10, 100 files                  | The total edit count stays fixed while the work is split across more files. A similar file outside `cases/` must stay unchanged. |
| `distinct-edits` | Apply a different old-to-new replacement in each file. | 1, 10, 30 files                   | Each file needs its own exact replacement, so one global command is not enough.                                                  |

### Select the right matches

These tasks contain repeated structures and ask for only some of them to change.

| Family          | What the agent must do                                       | Scales                  | What gets harder                                                                                  |
| --------------- | ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `select-one`    | Change one named test among many similar tests.              | 1, 10, 100, 1,000 tests | The target stays one test while the number of decoys grows.                                       |
| `select-subset` | Change the first, middle, and last named tests.              | 10, 100, 1,000 tests    | Three targets must change while all other matches stay byte-identical.                            |
| `delete-subset` | Delete the complete first, middle, and last test blocks.     | 10, 100, 1,000 tests    | The agent must select the right block boundaries and preserve spacing around the remaining tests. |
| `insert-subset` | Insert one assertion into the first, middle, and last tests. | 10, 100, 1,000 tests    | The insertion point repeats in every test, but only three named tests may change.                 |

### Edit whole blocks

Block tasks use exact begin and end marker lines around a table-driven test. The scale is usually the number of rows inside the source block.

| Family           | What the agent must do                                     | Scales                          | What gets harder                                                          |
| ---------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `replace-block`  | Replace the text between two markers and keep the markers. | 10, 100, 1,000 source rows      | The removed block grows.                                                  |
| `delete-block`   | Delete the marked block, including both markers.           | 10, 100, 1,000 source rows      | The deleted range grows while surrounding text must join exactly.         |
| `move-block`     | Move the marked block to another place in the same file.   | 10, 100, 1,000 source rows      | The agent must preserve a larger block and remove only its original copy. |
| `copy-block`     | Copy the marked block from one file to another.            | 10, 100, 1,000 source rows      | The copied block grows; the source must not change.                       |
| `copy-within`    | Copy the marked block to the end of the same file.         | 10, 100, 1,000 source rows      | The agent must keep the original and create one exact copy.               |
| `move-between`   | Move the marked block from one file to another.            | 10, 100, 1,000 source rows      | Both files must end in the exact expected state.                          |
| `insert-block`   | Insert one fixed test after the marked block.              | 10, 100, 1,000 surrounding rows | The inserted text stays fixed while the nearby source block grows.        |
| `insert-payload` | Insert a new table-driven test before a marker.            | 10, 100, 1,000 inserted rows    | The payload itself grows from a small block to a large exact insertion.   |

### Preserve literal bytes and Unicode

These tasks target text that is easy to reinterpret or normalize by accident.

| Family        | What the agent must do                                          | Cases                                                                                                                                    | What it tests                                                                                        |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `literal`     | Replace one exact literal string.                               | Regex-like text, quotes and backslashes, CRLF, tabs, and no final newline                                                                | Whether the agent treats the prompt as literal text and preserves line endings and file termination. |
| `unicode-fix` | Change one target while leaving a line of lookalikes unchanged. | Non-breaking space, narrow space, zero-width space, word joiner, non-breaking hyphen, Unicode minus, decomposed accent, and Cyrillic `а` | Whether the agent can distinguish characters that look alike.                                        |

### Work in different file formats

Language fixtures put the same editing operations into realistic-looking files. They do not test whether code compiles. They test whether syntax and writing system affect exact editing.

Each fixture contains 10 similar entries and produces three tasks:

| Family             | Operation                                    | Scale              |
| ------------------ | -------------------------------------------- | ------------------ |
| `language-replace` | Replace the value in all 10 entries.         | 10 occurrences     |
| `language-select`  | Replace only the fifth entry.                | 10 similar entries |
| `language-insert`  | Insert one new entry before the fifth entry. | 1 inserted entry   |

The generator uses 18 language-shaped fixtures per variant:

- TypeScript, TSX, Python, Go, Rust, C#, Java, Kotlin, SQL, shell, JSON, and YAML;
- one general Markdown fixture;
- Markdown written in Latin-script French, Russian, Chinese, Arabic, and a mixed-script form.

That gives 54 language tasks per variant and 108 language tasks in total.

Selection always changes the fifth entry. Insertion creates entry 11 and places it before entry 5. JSON uses a special payload with a trailing comma and newline so the requested insertion keeps the separators exact.

`plain` describes the fixture variant, not an ASCII-only file. The plain localized Markdown fixtures already contain French accents, Cyrillic, Chinese, and Arabic text. Their Unicode twins add a word joiner to the values and notes.

## Plain and Unicode variants

Nearly every task has a `plain` and a `unicode` twin. The operation and scale stay the same, but the Unicode twin introduces characters that byte-oriented tools often damage:

- a zero-width space inside the old and new values;
- non-breaking and narrow spaces;
- several hyphen, dash, and minus characters;
- composed and decomposed accented text;
- a word joiner;
- localized and mixed writing systems in Markdown.

The prompt renders non-ASCII quoted text as explicit `\uXXXX` escapes. The agent must decode those escapes to actual characters before editing.

There are 109 plain tasks and their 109 Unicode twins. Eight additional `unicode-fix` tasks have no plain twin, for 226 tasks overall.

## What scale means

Scale changes one dimension at a time where possible:

- **More context:** `unique` keeps one edit and adds unrelated lines.
- **More matches:** `replace-all` increases the number of required replacements.
- **More decoys:** selection families keep one or three targets and add similar non-targets.
- **More files:** `multi-file` keeps 1,000 replacements but spreads them across more files.
- **More independent instructions:** `distinct-edits` adds files with different replacements.
- **Larger source blocks:** replace, delete, copy, and move families grow the marked block.
- **Larger inserted content:** `insert-payload` grows the exact payload.

This is controlled scaling, not a claim that a 1,000-line task is exactly 100 times harder than a 10-line task. The scales show where an agent or tool starts to miss matches, select the wrong range, normalize bytes, or disturb unrelated content.

## Reproducing the matrix

Print the public task metadata:

```sh
npm run bench:list
```

The command lists all 226 tasks with their fixture hashes. To inspect or change generation, read the generator rather than editing generated output. Any generator change alters fixture hashes and belongs to a new benchmark task-set identity.
