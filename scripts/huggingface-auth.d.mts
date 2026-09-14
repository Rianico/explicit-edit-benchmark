export interface HuggingFaceTokenEnvironment {
  HF_TOKEN?: string;
  HF_TOKEN_PATH?: string;
  HF_HOME?: string;
  XDG_CACHE_HOME?: string;
}

export interface ResolveHuggingFaceTokenOptions {
  accessToken?: string;
  env?: HuggingFaceTokenEnvironment;
  homeDirectory?: string;
}

/** Resolve an explicit token, HF_TOKEN, or the token saved by `hf auth login`. */
export function resolveHuggingFaceToken(
  options?: ResolveHuggingFaceTokenOptions,
): Promise<string | null>;
