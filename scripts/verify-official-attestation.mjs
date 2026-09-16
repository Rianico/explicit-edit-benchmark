#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { approvedWorkflow, loadOfficialPolicy } from "./official-policy.mjs";

const [artifact, bundle, callerRepository, policyFile, signerDigest] = process.argv.slice(2);

if (!artifact || !bundle || !callerRepository || !policyFile || !signerDigest) {
  throw new Error(
    "Usage: verify-official-attestation.mjs ARTIFACT BUNDLE CALLER_REPOSITORY POLICY_FILE SIGNER_SHA",
  );
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(callerRepository))
  throw new Error("Invalid caller repository");
const policy = await loadOfficialPolicy(policyFile);
approvedWorkflow(policy, signerDigest);

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
    policy.attestation.signerWorkflow,
    "--signer-digest",
    signerDigest,
    "--deny-self-hosted-runners",
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
