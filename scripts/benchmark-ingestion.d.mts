export interface IngestionAccount {
  ownerId: string;
}

export interface IngestionServer {
  url: string;
  close(): Promise<void>;
}

/** Return accepted submission metadata from an append-only ingestion store. */
export function listAcceptedSubmissions(storeDirectory: string): Promise<Record<string, unknown>[]>;

/** Validate and atomically append one normalized observation bundle. */
export function ingestSubmission(
  storeDirectory: string,
  account: IngestionAccount,
  submission: unknown,
): Promise<{ submissionId: string; created: boolean }>;

/** Start the authenticated benchmark ingestion HTTP service. */
export function createIngestionServer(options: {
  storeDirectory: string;
  apiKeys?: Record<string, IngestionAccount>;
  apiKeyHashes?: Record<string, IngestionAccount>;
  host?: string;
  port?: number;
  maxBytes?: number;
}): Promise<IngestionServer>;
