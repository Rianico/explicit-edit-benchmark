import type { NormalizedRunManifest } from "./normalized-run.mjs";

/** Validate hashes, safe fields, identities and foreign keys in a normalized run bundle. */
export function validateNormalizedRun(directory: string): Promise<NormalizedRunManifest>;

/** Reject published content that would leak credentials or machine-local paths. */
export function rejectSensitiveText(content: string, label: string): void;
