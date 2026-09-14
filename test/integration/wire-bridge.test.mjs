import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createWireBridge, responseCompletionStream } from "../../scripts/wire-bridge.mjs";

/** Collect the JSON payloads of a Responses stream, so a test can read what a client would get. */
async function streamedEvents(source) {
  const transform = responseCompletionStream();
  const chunks = [];
  transform.on("data", (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve) => transform.on("end", resolve));
  // Byte by byte: a real stream arrives in fragments that do not respect event boundaries.
  for (const byte of Buffer.from(source)) transform.write(Buffer.from([byte]));
  transform.end();
  await ended;
  return Buffer.concat(chunks)
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

await test("the final output is restored from completed items without touching anything else", async () => {
  const item = {
    id: "one",
    type: "message",
    content: [{ type: "output_text", text: "中文 العربية русский" }],
  };
  const events = await streamedEvents(
    "data: " +
      JSON.stringify({ type: "response.output_item.done", output_index: 0, item }) +
      "\n\ndata: " +
      JSON.stringify({
        type: "response.completed",
        response: { model: "gpt-5.6-luna", reasoning: { effort: "low" }, output: [] },
      }) +
      "\n\n",
  );
  assert.deepEqual(events[1].response.output, [item]);
  assert.equal(events[1].response.reasoning.effort, "low");
  assert.equal(events[1].response.model, "gpt-5.6-luna");
});

await test("a stream that already carries its output is left alone", async () => {
  const payload = {
    type: "response.completed",
    response: { model: "m", output: [{ id: "given", type: "message" }] },
  };
  const events = await streamedEvents("data: " + JSON.stringify(payload) + "\n\n");
  assert.deepEqual(events[0].response.output, [{ id: "given", type: "message" }]);
});

await test("the bridge fixes the SSE content type, keeps JSON errors, and forwards the request", async () => {
  const seen = [];
  const upstream = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push(body);
      response.setHeader("content-type", "application/json");
      if (request.url === "/error") {
        response.writeHead(400);
        response.end('{"error":"bad"}');
      } else response.end("event: ping\ndata: {}\n\n");
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const bridge = createWireBridge({ upstream: `http://127.0.0.1:${upstream.address().port}` });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${bridge.address().port}`;
    const streamed = await fetch(base, { method: "POST", body: '{"stream":true}' });
    assert.equal(streamed.headers.get("content-type"), "text/event-stream");
    assert.equal(await streamed.text(), "event: ping\ndata: {}\n\n");
    const failed = await fetch(`${base}/error`, { method: "POST", body: '{"stream":true}' });
    assert.equal(failed.status, 400);
    assert.equal(failed.headers.get("content-type"), "application/json");
    assert.deepEqual(await failed.json(), { error: "bad" });
    assert.deepEqual(seen, ['{"stream":true}', '{"stream":true}']);
  } finally {
    bridge.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => bridge.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});

await test("an upstream that refuses the connection answers 502 instead of hanging", async () => {
  // A port that was just closed refuses immediately, which is what a bridge that is not running does.
  const closed = http.createServer((_, response) => response.end());
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const bridge = createWireBridge({ upstream: `http://127.0.0.1:${port}` });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.address().port}`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 502);
  } finally {
    bridge.closeAllConnections();
    await new Promise((resolve) => bridge.close(resolve));
  }
});

await test("an upstream that never accepts the connection is cut off", async () => {
  // 127.0.0.1:1 swallows connections on this host, so only the connect timeout ends the wait.
  const bridge = createWireBridge({ upstream: "http://127.0.0.1:1", connectTimeoutMs: 300 });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  try {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${bridge.address().port}`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 502);
    assert.ok(Date.now() - started < 5_000, "the client must not wait for the harness timeout");
  } finally {
    bridge.closeAllConnections();
    await new Promise((resolve) => bridge.close(resolve));
  }
});
