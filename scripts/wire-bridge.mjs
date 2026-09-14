#!/usr/bin/env node
import http from "node:http";
import { appendFileSync } from "node:fs";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { parseArgs } from "node:util";

/**
 * Sit in front of a bridge that exposes an OAuth subscription as an OpenAI-compatible endpoint
 * (vekil and friends) and repair the two things those bridges get wrong for the Responses API:
 *
 * 1. a streaming body labelled `application/json` instead of `text/event-stream`;
 * 2. a final `response.completed` event with an empty `output`, while the items were already
 *    delivered in `response.output_item.done` events.
 *
 * Requests are forwarded unchanged, and nothing rewrites the model, the reasoning setting, or the
 * generated text. That is deliberate: this is a transport fix, not a place to shape results.
 *
 *   node scripts/wire-bridge.mjs --upstream http://127.0.0.1:1337 --port 1339 [--log FILE]
 *
 * A bridge that never answers would otherwise hang the harness until its own timeout, so the
 * connection phase is bounded. Wait for the first token is not bounded: a model may think for a
 * long time before it streams, and cutting that off would corrupt a valid run.
 *
 * `--log` appends one line per request with the path, model, reasoning setting and stream flag.
 * It never writes headers, prompts, or generated text.
 */

/** Reconstruct the final Responses output from completed streamed items when omitted upstream. */
export function responseCompletionStream() {
  let pending = "";
  const items = new Map();
  const decoder = new StringDecoder("utf8");
  const convert = (line) => {
    if (!line.startsWith("data: ")) return line;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === "response.output_item.done") items.set(event.output_index, event.item);
      if (
        event.type === "response.completed" &&
        event.response &&
        !event.response.output?.length &&
        items.size
      ) {
        event.response.output = [...items.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => value);
        return "data: " + JSON.stringify(event);
      }
    } catch {}
    return line;
  };
  return new Transform({
    transform(chunk, encoding, done) {
      pending += decoder.write(chunk);
      let index;
      while ((index = pending.indexOf("\n")) >= 0) {
        this.push(convert(pending.slice(0, index)) + "\n");
        pending = pending.slice(index + 1);
      }
      done();
    },
    flush(done) {
      if (pending) this.push(convert(pending));
      done();
    },
  });
}

/** Proxy one upstream endpoint with the repairs above. Pass a URL, not a port. */
export function createWireBridge({ upstream, logFile, connectTimeoutMs = 10_000 }) {
  const target = new URL(upstream);
  return http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (logFile) {
        try {
          const data = JSON.parse(body);
          appendFileSync(
            logFile,
            JSON.stringify({
              timestamp: Date.now(),
              path: request.url,
              model: data.model,
              reasoning: data.reasoning,
              stream: data.stream,
            }) + "\n",
          );
        } catch {}
      }
      const forwarded = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: target.host },
        },
        (incoming) => {
          let sent = false;
          const normalized = responseCompletionStream();
          normalized.pipe(response);
          const pending = [];
          const send = () => {
            const first = Buffer.concat(pending);
            const headers = { ...incoming.headers };
            if (/^(event:|data:)/.test(first.toString("utf8")))
              headers["content-type"] = "text/event-stream";
            delete headers["content-length"];
            response.writeHead(incoming.statusCode, headers);
            normalized.write(first);
            sent = true;
          };
          incoming.on("data", (chunk) => {
            if (sent) normalized.write(chunk);
            else {
              pending.push(chunk);
              if (Buffer.concat(pending).length >= 6) send();
            }
          });
          incoming.on("end", () => {
            if (!sent) send();
            normalized.end();
          });
          incoming.on("error", () => response.destroy());
        },
      );
      let connectTimer;
      forwarded.on("socket", (socket) => {
        if (!socket.connecting) return;
        connectTimer = setTimeout(
          () => forwarded.destroy(Error("upstream connect timeout")),
          connectTimeoutMs,
        );
        socket.once("connect", () => clearTimeout(connectTimer));
      });
      forwarded.on("error", () => {
        clearTimeout(connectTimer);
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.on("close", () => forwarded.destroy());
      forwarded.end(body);
    });
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      upstream: { type: "string" },
      port: { type: "string", default: "1339" },
      "connect-timeout-ms": { type: "string", default: "10000" },
      log: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.upstream) {
    console.log(
      "Usage: node scripts/wire-bridge.mjs --upstream URL [--port 1339] [--log FILE] [--connect-timeout-ms 10000]. Repairs an OpenAI-compatible endpoint that an OAuth subscription is bridged through.",
    );
    process.exit(values.help ? 0 : 1);
  }
  const bridge = createWireBridge({
    upstream: values.upstream,
    logFile: values.log,
    connectTimeoutMs: Number(values["connect-timeout-ms"]),
  });
  bridge.listen(Number(values.port), "127.0.0.1", () =>
    console.log(`wire bridge: http://127.0.0.1:${values.port} -> ${values.upstream}`),
  );
}
