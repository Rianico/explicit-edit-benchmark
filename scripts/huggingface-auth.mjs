import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Resolve an explicit token, HF_TOKEN, or the token saved by `hf auth login`. */
export async function resolveHuggingFaceToken({
  accessToken,
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  if (accessToken) return accessToken;
  if (env.HF_TOKEN) return env.HF_TOKEN;
  const cacheDirectory = env.XDG_CACHE_HOME ?? path.join(homeDirectory, ".cache");
  const tokenPath =
    env.HF_TOKEN_PATH ??
    path.join(env.HF_HOME ?? path.join(cacheDirectory, "huggingface"), "token");
  try {
    const token = (await readFile(tokenPath, "utf8")).trim();
    return token || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
