#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const run = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: analyze-ide-bash-usage.mjs RUN [OUTPUT]");
const summary = JSON.parse(await readFile(path.join(run, "summary.json"), "utf8"));
const nativeMutations = new Set([
  "apply",
  "edit",
  "write",
  "replace",
  "insert",
  "delete",
  "copy",
  "move",
]);
const mutationPatterns = {
  "sed -i": /\bsed\b[^\n]*(?:\s-i(?:\s|['"]|-)|--in-place)/u,
  "perl -i/-pi": /\bperl\b[^\n]*\s-[^\s]*i[^\s]*/u,
  "Python write script":
    /\bpython(?:3)?\b[\s\S]*(?:\.write\s*\(|\.write_(?:text|bytes)\s*\(|\.writelines\s*\(|open\s*\([^\n)]*,\s*(?:encoding\s*=\s*[^,]+,\s*)?['"][wax+]|shutil\.(?:copy|move)|fileinput\.input\s*\([^)]*inplace\s*=\s*True)/u,
  "Node fs write script":
    /\bnode\b[\s\S]*(?:writeFile|appendFile|copyFile|renameSync|createWriteStream)/u,
  "append/redirect into workspace file":
    /(?:sed|awk|cat|printf|echo|head|tail)\b[^\n]*(?:>>?|\|\s*tee(?:\s+-a)?)\s+(?!(?:\/tmp|\/dev|null|\$))["']?(?:\/workspace\/)?[^\s;&|"']+\.(?:ts|js|py|go|md|txt|json|yaml|yml|toml|rs|java|c|cpp|h)\b/u,
  "cp/mv/install into workspace":
    /(?:^|[;&|\n]\s*)(?:cp|mv|install)\b[^\n]*(?:\/workspace\/|\s+(?!\/tmp)[^\s;&|]+\.(?:ts|js|py|go|md|txt|json|yaml|yml|toml|rs|java|c|cpp|h)\b)/u,
  "truncate/rm target":
    /(?:^|[;&|\n]\s*)(?:truncate\b|rm\b[^\n]*\.(?:ts|js|py|go|md|txt|json|yaml|yml|toml|rs|java|c|cpp|h)\b)/u,
  "patch/git apply": /\b(?:patch|git\s+apply|apply_patch)\b/u,
};
const activityPatterns = {
  grep: /\b(?:grep|rg)\b/u,
  "find/ls/stat/file": /\b(?:find|ls|stat|file)\b/u,
  "head/tail": /\b(?:head|tail)\b/u,
  sed: /\bsed\b/u,
  cat: /\bcat\b/u,
  "xxd/od/hexdump": /\b(?:xxd|od|hexdump)\b/u,
  "wc/diff/cmp": /\b(?:wc|diff|cmp)\b/u,
  Python: /\bpython(?:3)?\b/u,
  Perl: /\bperl\b/u,
  Node: /\bnode\b/u,
};
const modes = { nativeOnly: 0, bashOnly: 0, both: 0, neither: 0 };
const nativeCalls = {};
const mutationMechanisms = {};
const bashActivities = {};
const byModel = {};
let bashCalls = 0;
let passedWithoutNativeMutation = 0;

const add = (records, name, chain) => {
  const item = (records[name] ??= { calls: 0, chains: new Set() });
  item.calls++;
  item.chains.add(chain);
};
for (const result of summary.results.filter((item) => item.profile.endsWith("-ide"))) {
  const model = result.profile.slice(0, -4);
  const modelStats = (byModel[model] ??= {
    chains: 0,
    bashCalls: 0,
    nativeMutationCalls: 0,
    mutationShapedBashCalls: 0,
    mutationShapedBashChains: 0,
    passedWithoutNativeMutation: 0,
    mechanisms: {},
  });
  modelStats.chains++;
  let usedNative = false;
  let usedBash = false;
  const chainMechanisms = new Set();
  for (const attempt of result.recovery?.attempts ?? []) {
    const file = path.join(
      run,
      "trials",
      result.id,
      "rounds",
      String(attempt.attempt),
      "tool-calls.json",
    );
    let events = [];
    try {
      events = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const event of events.filter((item) => item.type === "tool_execution_start")) {
      if (nativeMutations.has(event.toolName)) {
        usedNative = true;
        modelStats.nativeMutationCalls++;
        nativeCalls[event.toolName] = (nativeCalls[event.toolName] ?? 0) + 1;
      }
      if (event.toolName !== "bash") continue;
      usedBash = true;
      bashCalls++;
      modelStats.bashCalls++;
      const command = event.args?.command ?? "";
      let mutationShaped = false;
      for (const [name, pattern] of Object.entries(mutationPatterns)) {
        if (!pattern.test(command)) continue;
        mutationShaped = true;
        chainMechanisms.add(name);
        add(mutationMechanisms, name, result.id);
      }
      if (mutationShaped) modelStats.mutationShapedBashCalls++;
      for (const [name, pattern] of Object.entries(activityPatterns))
        if (pattern.test(command)) add(bashActivities, name, result.id);
    }
  }
  modes[usedNative ? (usedBash ? "both" : "nativeOnly") : usedBash ? "bashOnly" : "neither"]++;
  if (chainMechanisms.size) modelStats.mutationShapedBashChains++;
  for (const mechanism of chainMechanisms)
    modelStats.mechanisms[mechanism] = (modelStats.mechanisms[mechanism] ?? 0) + 1;
  if (result.recovery?.attempts?.at(-1)?.passed && !usedNative) {
    passedWithoutNativeMutation++;
    modelStats.passedWithoutNativeMutation++;
  }
}
const plain = (records) =>
  Object.fromEntries(
    Object.entries(records).map(([name, value]) => [
      name,
      { calls: value.calls, chains: value.chains.size },
    ]),
  );
const report = {
  run: path.basename(run),
  ideChains: Object.values(modes).reduce((sum, value) => sum + value, 0),
  modes,
  passedWithoutNativeMutation,
  nativeMutationCalls: nativeCalls,
  bashCalls,
  mutationMechanisms: plain(mutationMechanisms),
  bashActivities: plain(bashActivities),
  byModel,
  notes: [
    "A chain includes all same-session oracle rounds.",
    "Passing without a native mutation means the required file change happened through Bash.",
    "Bash categories are lexical and may overlap when one command chains several utilities.",
  ],
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv[3]) await writeFile(process.argv[3], text);
else process.stdout.write(text);
