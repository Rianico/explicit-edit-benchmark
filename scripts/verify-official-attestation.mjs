#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const [artifact, bundle, callerRepository, signerDigest] = process.argv.slice(2);

if (!artifact || !bundle || !callerRepository || !signerDigest) {
  throw new Error(
    "Usage: verify-official-attestation.mjs ARTIFACT BUNDLE CALLER_REPOSITORY APPROVED_SIGNER_SHA",
  );
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(callerRepository))
  throw new Error("Invalid caller repository");
if (!/^[a-f0-9]{40}$/.test(signerDigest)) throw new Error("Invalid approved signer SHA");

const gh = process.env.GH_COMMAND || "gh";
const result = spawnSync(
  gh,
  [
    "attestation",
    "verify",
    path.resolve(artifact),
    "--bundle",
    path.resolve(bundle),
    "--repo",
    callerRepository,
    "--signer-workflow",
    "alexshpunt/explicit-edit-benchmark/.github/workflows/official-run.yml",
    "--signer-digest",
    signerDigest,
    "--deny-self-hosted-runners",
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
