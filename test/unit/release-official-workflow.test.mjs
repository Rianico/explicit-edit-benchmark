import assert from "node:assert/strict";
import test from "node:test";
import { pinCallerTemplate } from "../../scripts/release-official-workflow.mjs";

const old = "a".repeat(40);
const current = "b".repeat(40);

test("one derived workflow SHA updates both caller pins", () => {
  const template = `uses: owner/repo/.github/workflows/official-run.yml@${old}\nsigner_sha: ${old}\n`;
  assert.equal(
    pinCallerTemplate(template, current),
    `uses: owner/repo/.github/workflows/official-run.yml@${current}\nsigner_sha: ${current}\n`,
  );
});

test("release pinning fails when the caller template layout drifts", () => {
  assert.throws(() => pinCallerTemplate(`signer_sha: ${old}\n`, current), /pin layout/);
});
