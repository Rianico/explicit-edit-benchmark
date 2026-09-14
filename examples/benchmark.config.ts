import { defineBenchmarkConfig, defineHarness } from "../scripts/benchmark-config.mjs";

const localCli = defineHarness({
  createAdapter({ model }) {
    const selectedModel = model.selectors?.localCli;
    if (!selectedModel) throw new Error("Model has no localCli selector");
    return {
      kind: "custom",
      command: "/absolute/path/to/your-agent",
      args: ["--model", selectedModel, "--prompt", "{prompt}"],
      version: "replace-with-installed-version",
      agentFamily: "your-agent",
      agentVersion: "replace-with-agent-version",
      modelFamily: model.family,
      modelVersion: model.version,
      provider: model.provider ?? null,
      harnessFamily: "your-agent-cli",
      adapterVersion: "1",
      configurationLabels: ["tools/default"],
      configurationId: "your-agent-cli/default",
      configuration: {
        tools: ["replace-with-tool-list"],
        extensions: ["replace-with-extension@version"],
        rules: ["replace-with-rule-id@sha256"],
        runtimeFlags: [`thinking=${model.thinking}`],
        environment: ["REPLACE_WITH_REQUIRED_ENV_NAME"],
      },
      model: selectedModel,
      thinking: model.thinking,
      ready: false,
      readOnly: ["/absolute/path/to/your-agent-installation"],
    };
  },
});

export default defineBenchmarkConfig({
  models: {
    example: {
      family: "model-family",
      version: "exact-model-version",
      provider: "provider",
      thinking: "low",
      selectors: { localCli: "provider-model-id" },
    },
  },
  harnesses: {
    "local-cli": localCli,
  },
  selection: {
    matrix: [{ models: ["example"], harnesses: ["local-cli"] }],
    pairs: [],
  },
});
