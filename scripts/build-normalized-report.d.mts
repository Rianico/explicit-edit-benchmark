/** Build Markdown and CSV summaries from one validated normalized run bundle. */
export function buildNormalizedReport(
  bundleDirectory: string,
  outputDirectory: string,
): Promise<{ profiles: number; report: string }>;
