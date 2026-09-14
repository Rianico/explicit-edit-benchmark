import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ADAPTER_IDS } from "../../scripts/prepare-benchmark.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const adapterIds = new Set(ADAPTER_IDS);

/** Every document a reader can follow, because each of them names adapters. */
async function documentedFiles() {
  const files = ["README.md"];
  for (const directory of ["docs", ".agents/skills"]) {
    for (const entry of await readdir(path.join(repository, directory))) {
      if (directory === "docs" && entry.endsWith(".md")) files.push(path.join(directory, entry));
      if (directory === ".agents/skills") files.push(path.join(directory, entry, "SKILL.md"));
    }
  }
  return files;
}

await test("the README lists exactly the adapters the code can run", async () => {
  const readme = await readFile(path.join(repository, "README.md"), "utf8");
  const table = readme.slice(
    readme.indexOf("| `--harness`"),
    readme.indexOf("Install and log in to that CLI yourself."),
  );
  const listed = new Set(
    [...table.matchAll(/^\| `([a-z0-9-]+)`/gm)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith("--")),
  );
  assert.deepEqual([...listed].sort(), [...adapterIds].sort());
});

await test("every documented --harness name is a real adapter", async () => {
  for (const file of await documentedFiles()) {
    const text = await readFile(path.join(repository, file), "utf8");
    for (const match of text.matchAll(/--harness ([a-z0-9-]+)/g))
      assert.ok(
        adapterIds.has(match[1]),
        `${file} tells the reader to run --harness ${match[1]}, which no adapter supports`,
      );
  }
});
