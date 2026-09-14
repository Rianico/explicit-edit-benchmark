/** Shared workspace facts for every mechanical task, independent of the agent profile. */
export const mechanicalWorkspaceRules = [
  "All file paths are relative to the current working directory. Open explicitly named files directly; search for their location only if the supplied path cannot be resolved. Searching within files for the requested content is allowed.",
  "There is no Git repository in this workspace. Do not run Git commands or create a Git repository.",
].join("\n");
