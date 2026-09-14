import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Test scratch directory, in the system temp folder, so a fresh checkout needs nothing. */
export function tempDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}
