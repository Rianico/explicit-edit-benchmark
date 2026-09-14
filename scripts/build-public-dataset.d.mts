export interface PublicDatasetIndex {
  schemaVersion: 1;
  runs: Array<{ runId: string; manifestSha256: string; [key: string]: unknown }>;
  summary?: Record<string, unknown>;
  source?: { path: string; bytes: number; sha256: string };
}

/** Build gzip JSONL shards ready for review and upload to a public dataset. */
export function buildPublicDataset(
  outputDirectory: string,
  bundleDirectories: string[],
): Promise<PublicDatasetIndex>;

/** Build a public dataset from every accepted observation in an ingestion store. */
export function buildPublicDatasetFromStore(
  outputDirectory: string,
  storeDirectory: string,
): Promise<PublicDatasetIndex>;
