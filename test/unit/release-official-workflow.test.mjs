import assert from "node:assert/strict";
import test from "node:test";
import { pinCallerTemplate } from "../../scripts/release-official-workflow.mjs";

const old = "a".repeat(40);
const current = "b".repeat(40);
const policy = "c".repeat(40);

test("one derived workflow SHA updates both caller pins", () => {
  const template = `uses: owner/repo/.github/workflows/official-run.yml@${old}\npolicy_sha: ${old}\nsigner_sha: ${old}\nuses: owner/repo/.github/workflows/official-submit.yml@${old}\npolicy_sha: ${old}\n`;
  assert.equal(
    pinCallerTemplate(template, current, policy),
    `uses: owner/repo/.github/workflows/official-run.yml@${current}\npolicy_sha: ${policy}\nsigner_sha: ${current}\nuses: owner/repo/.github/workflows/official-submit.yml@${policy}\npolicy_sha: ${policy}\n`,
  );
});

test("release pinning fails when the caller template layout drifts", () => {
  assert.throws(() => pinCallerTemplate(`signer_sha: ${old}\n`, current, policy), /pin layout/);
});
