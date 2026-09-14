#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * Drive the DeepSeek Harness SDK for one benchmark trial.
 *
 * The `dsh-standard` and `dsh-code` adapters do not call the CLI per prompt: they seed this file
 * into the sandbox and run it as a persistent driver, the same way the bb example does. The
 * benchmark writes one JSON line per turn and expects one `eval/turn-complete` line back.
 *
 *   node dsh-sdk-runner.mjs DSH_PROGRAM PROVIDER MODEL THINKING
 *
 * It speaks the SDK's JSON-RPC over stdio, forwards every `session.event` frame to stdout so the
 * harness parser can read rounds and tool calls, and waits for the session to become idle after
 * each prompt. It writes no credentials and touches no files outside the workspace and the state
 * directory the sandbox mounted.
 */

const [dsh, provider, model, thinking] = process.argv.slice(2);
if (!dsh || !provider || !model || !thinking) {
  throw Error("Usage: dsh-sdk-runner DSH PROVIDER MODEL THINKING");
}

const child = spawn(dsh, ["--profile", "sdk"], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.pipe(process.stderr);
const sessionId = `eval-${randomUUID()}`;
const pending = new Map();
let requestId = 0;
let turn;
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const serverLines = readline.createInterface({ input: child.stdout });
serverLines.on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (frame.id !== undefined && !frame.method) {
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.error) waiter.reject(Error(frame.error.message));
    else waiter.resolve(frame.result);
    return;
  }
  if (frame.method === "session.event" && frame.params?.sessionId === sessionId) {
    const event = frame.params.event;
    process.stdout.write(`${JSON.stringify(event)}\n`);
    if (event.type === "turn/end") turn.finalReason = event.data?.reason;
  }
  if (frame.method === "session.status" && frame.params?.sessionId === sessionId) {
    if (frame.params.status === "running") turn.sawRunning = true;
    if (turn.sawRunning && frame.params.status === "idle") turn.resolveIdle();
  }
});
const exited = new Promise((_, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) =>
    reject(Error(`DeepSeek Harness SDK exited before completion (${code ?? signal})`)),
  );
});
await Promise.race([
  send("initialize", { cwd: "/workspace", provider, model, reasoningEffort: thinking }),
  exited,
]);

const prompts = readline.createInterface({ input: process.stdin });
for await (const line of prompts) {
  const { prompt } = JSON.parse(line);
  if (typeof prompt !== "string" || !prompt.trim()) throw Error("A non-empty prompt is required");
  turn = { sawRunning: false, finalReason: undefined };
  const idle = new Promise((resolve) => (turn.resolveIdle = resolve));
  await Promise.race([
    (async () => {
      await send("session/prompt", {
        sessionId,
        contentBlocks: [{ type: "text", text: prompt }],
      });
      await idle;
    })(),
    exited,
  ]);
  process.stdout.write(
    `${JSON.stringify({ type: "eval/turn-complete", reason: turn.finalReason })}\n`,
  );
}
await Promise.race([send("shutdown", {}), exited]);
serverLines.close();
child.stdin.end();
