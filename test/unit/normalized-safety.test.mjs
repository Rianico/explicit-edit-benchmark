import assert from "node:assert/strict";
import test from "node:test";
import { rejectSensitiveText } from "../../scripts/validate-normalized-run.mjs";

// Build every sample from parts. Secret scanners must not mistake these
// fixtures for real credentials, so no complete token may appear in this
// file's text.
const sample = (...parts) => parts.join("");
const value = (text) => JSON.stringify({ value: text });

const REJECTED = [
  ["private key block", value(sample("-----BEGIN OPENSSH", " PRIVATE KEY-----"))],
  ["openai project key", value(sample("sk-proj-", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["openai legacy key", value(sample("sk-", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["anthropic key", value(sample("sk-ant-api03-", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["stripe key", value(sample("sk_live_", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["hugging face token", value(sample("hf_", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["github token", value(sample("ghp_", "AbCdEfGhIjKlMnOpQrStUvWx"))],
  ["github fine-grained token", value(sample("github_pat_", "AbCdEfGhIjKlMnOp"))],
  ["slack token", value(sample("xoxb-", "123456789012-abcdefghijklmnop"))],
  ["google api key", value(sample("AIza", "SyA1234567890abcdefghijklmnopqrstu"))],
  ["aws access key", value(sample("AKIA", "IOSFODNN7EXAMPLE"))],
  ["root path", value(sample("/", "root/dev/work"))],
  ["home path", value(sample("/home", "/user/work"))],
];

const ACCEPTED = [
  ["model and harness identity", '{"model":"openai/gpt-5","harnessFamily":"pi-default"}'],
  ["sandbox path", '{"path":"/workspace/src/index.ts"}'],
  ["environment variable name", '{"environment":["OPENAI_API_KEY"]}'],
  [
    "task id and a word ending in sk",
    '{"taskId":"risk-check-10-plain","note":"task-note-1234567890"}',
  ],
];

await test("rejects published content that would leak credentials or machine-local paths", () => {
  for (const [name, content] of REJECTED)
    assert.throws(
      () => rejectSensitiveText(content, "profiles.jsonl"),
      /possible credential or machine-local path/,
      name,
    );
});

await test("accepts safe normalized content", () => {
  for (const [name, content] of ACCEPTED)
    assert.doesNotThrow(() => rejectSensitiveText(content, "profiles.jsonl"), name);
});
