import type { PublicDatasetIndex } from "./build-public-dataset.mjs";

export interface HuggingFaceContributionHub {
  listCommits(options: unknown): AsyncIterable<{ oid: string }>;
  listFiles(options: unknown): AsyncIterable<{ path: string; type?: string }>;
  snapshotDownload(options: { revision: string; [key: string]: unknown }): Promise<string>;
  uploadFiles(options: Record<string, unknown>): Promise<{
    pullRequestUrl?: string;
    commit: { oid: string };
  }>;
  whoAmI(options: unknown): Promise<{ name: string }>;
  commit(options: Record<string, unknown>): Promise<
    | {
        commit: { oid: string };
      }
    | undefined
  >;
}

export interface HuggingFaceAuthenticationOptions {
  accessToken?: string;
  homeDirectory?: string;
  env?: Record<string, string | undefined>;
}

export interface SubmitHuggingFaceCandidateOptions extends HuggingFaceAuthenticationOptions {
  bundleDirectory: string;
  metadataFile: string;
  repository: string;
  hub?: Pick<HuggingFaceContributionHub, "listCommits" | "uploadFiles" | "whoAmI">;
}

/** Upload a validated normalized bundle and safe metadata to a Hugging Face dataset pull request. */
export function submitHuggingFaceCandidate(options: SubmitHuggingFaceCandidateOptions): Promise<{
  runId: string;
  pullRequestUrl: string;
  commitOid: string;
}>;

export interface MaterializeHuggingFaceOptions {
  repository: string;
  accessToken?: string;
  workspaceDirectory: string;
  hub?: Pick<
    HuggingFaceContributionHub,
    "commit" | "listCommits" | "listFiles" | "snapshotDownload"
  >;
}

/** Accept one HF candidate against current main and atomically publish a complete rebuilt dataset. */
export function acceptHuggingFaceCandidate(
  options: MaterializeHuggingFaceOptions & { candidateRevision: string; dryRun?: boolean },
): Promise<{
  index: PublicDatasetIndex;
  outputDirectory: string;
  commitOid: string | null;
  runId: string;
}>;
