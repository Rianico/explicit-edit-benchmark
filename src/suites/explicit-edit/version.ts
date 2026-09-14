/**
 * One benchmark, one identity. The runner, the submit metadata, and every published bundle
 * use these values, so a reader never has to reconcile two versions of the same thing.
 */
export const explicitEditContract = "explicit-edit-v1";
export const explicitEditVersion = "1";
export const explicitEditBenchmarkId = "explicit-edit/explicit-edit";
export const explicitEditRunner = {
  id: "explicit-edit-benchmark",
  name: "Explicit Edit Benchmark",
} as const;
