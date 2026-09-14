export interface NormalizedToolEvent {
  ordinal: number;
  tool: string;
  category: string;
  outcome: "completed" | "error" | null;
  commandFeatures: string[];
}

export interface NormalizedRunManifest {
  schemaVersion: 1;
  runId: string;
  contract: unknown;
  taskSetSha256: string;
  verifierSha256?: unknown;
  sourceRuns?: Array<{ runId: string }>;
  policy: {
    oracleRecoveries: unknown;
    retryFailures: unknown;
    concurrency: unknown;
    timeoutMs: unknown;
  };
  counts: {
    profiles: number;
    configurations: number;
    trials: number;
    rounds: number;
    toolCalls: number;
  };
  completeness: {
    eofClassification: "complete" | "partial";
    unknownDifferences: number;
    toolCallCoverage: "complete" | "partial";
    unobservedToolCallRounds: number;
  };
  files: Record<string, { bytes: number; sha256: string }>;
}

/** Reject adapters that cannot produce a canonical public identity. */
export function assertNormalizedIdentity(adapter: Record<string, unknown>, label?: string): void;

/** Convert one harness-native tool event into a safe fact without raw arguments. */
export function normalizeToolEvent(raw: unknown, ordinal: number): NormalizedToolEvent;

export interface NormalizedRunExportOptions {
  profileIdentity?: (
    profileId: string,
    adapter: Record<string, unknown>,
    manifest: Record<string, unknown>,
  ) => Record<string, unknown>;
  historicalMetrics?: boolean;
}

/** Export safe versioned identities and observed efficiency facts needed for analysis. */
export function exportNormalizedRun(
  rootDirectory: string,
  outputDirectory: string,
  options?: NormalizedRunExportOptions,
): Promise<NormalizedRunManifest>;
