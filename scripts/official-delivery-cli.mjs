#!/usr/bin/env node
import { submitOfficialCandidate } from "./official-delivery.mjs";

function value(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

const args = process.argv.slice(2);
const artifact = value(args, "--artifact");
const attestation = value(args, "--attestation");
const manifest = value(args, "--manifest");
const signerWorkflowSha = value(args, "--signer-sha");
const repository = value(args, "--repository");
const statusFile = value(args, "--status-file");
if (!artifact || !attestation || !manifest || !signerWorkflowSha || !repository || !statusFile)
  throw Error(
    "Usage: official-delivery-cli.mjs --artifact FILE --attestation FILE --manifest FILE --signer-sha SHA --repository OWNER/DATASET --status-file FILE",
  );
const status = await submitOfficialCandidate({
  artifact,
  attestation,
  manifest,
  signerWorkflowSha,
  repository,
  statusFile,
  accessToken: process.env.HF_TOKEN,
});
console.log(JSON.stringify(status));
