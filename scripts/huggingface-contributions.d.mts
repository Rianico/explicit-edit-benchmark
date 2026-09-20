import type { PublicDatasetIndex } from "./build-public-dataset.mjs";

export interface HuggingFaceContributionHub {
  listCommits(options: unknown): AsyncIterable<{ oid: string }>;
  listFiles(options: unknown): AsyncIterable<{ path: string; type?: string }>;
  downloadFile(options: {
    revision: string;
    path: string;
    [key: string]: unknown;
  }): Promise<Blob | null>;
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

/** Fail closed unless compact source, Dataset, and aggregate indexes describe the same runs. */
export function verifyIncrementalDatasetState(
  sourceIndex: unknown,
  datasetIndex: PublicDatasetIndex,
  aggregateState: unknown,
): void;
/** Download only the immutable files belonging to one ordinary Dataset candidate. */
export function downloadHuggingFaceCandidate(options: {
  hub: Pick<HuggingFaceContributionHub, "downloadFile">;
  repo: unknown;
  repository: string;
  candidateNumber: string | number;
  accessToken: string;
  directory: string;
  fetchImpl?: typeof fetch;
}): Promise<{ candidateCommit: string; runId: string }>;

/** Post the acceptance receipt and close a materialized Dataset candidate. */
export function closeHuggingFaceCandidate(
  repository: string,
  candidateNumber: number,
  token: string,
  receipt: string,
  fetchImpl?: typeof fetch,
): Promise<void>;
export interface MaterializeHuggingFaceOptions {
  repository: string;
  accessToken?: string;
  discussionAccessToken?: string;
  workspaceDirectory: string;
  hub?: Pick<HuggingFaceContributionHub, "commit" | "downloadFile" | "listCommits" | "listFiles">;
  fetchImpl?: typeof fetch;
  close?: typeof closeHuggingFaceCandidate;
}

/** Validate one candidate and append only its source, shards, and updated compact views. */
export function acceptHuggingFaceCandidate(
  options: MaterializeHuggingFaceOptions & { candidateRevision: string; dryRun?: boolean },
): Promise<{
  index: PublicDatasetIndex;
  outputDirectory: string;
  commitOid: string | null;
  runId: string;
  candidateCommit: string;
  operationCount: number;
  candidateClosed?: boolean;
  closeError?: string | null;
  duplicate?: boolean;
}>;
