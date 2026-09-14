/** Hash an API key before it enters persistent account storage. */
export function hashApiKey(apiKey: string): string;

/** Register an owner and return the new API key exactly once. */
export function createBenchmarkAccount(registryFile: string, ownerId: string): Promise<string>;

/** Load the hashed API-key registry used by the ingestion service. */
export function loadBenchmarkAccounts(
  registryFile: string,
): Promise<Record<string, { ownerId: string }>>;
