import { readFile } from "node:fs/promises";

/**
 * bb item types, taken from the bb-app type declarations, not from guesses.
 *
 * An action item becomes one tool call. Names the benchmark already knows are mapped to the
 * name it publishes, so a bb run is comparable with other harnesses; the rest keep bb's own
 * name rather than a made-up one. A conversation, reasoning, or engine item is not a call.
 */
const ACTION_ITEMS = {
  commandExecution: "command_execution",
  fileChange: "edit",
  fileRead: "read",
  search: "search",
  webSearch: "webSearch",
  webFetch: "webFetch",
  imageView: "imageView",
  imageGeneration: "imageGeneration",
  backgroundTask: "backgroundTask",
  delegation: "delegation",
};
const NON_ACTION_ITEMS = new Set([
  "userMessage",
  "agentMessage",
  "text",
  "image",
  "localImage",
  "localFile",
  "reasoning",
  "plan",
  "planSteps",
  "contextCompaction",
  "extension",
]);

/** Name one completed item as a tool call, or refuse instead of under-counting. */
function callFromItem(item, index) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "toolCall") {
    if (typeof item.tool !== "string" || !item.tool)
      throw Error(`bb completed a tool call without a tool name: ${JSON.stringify(item.id)}`);
    return { type: "item.completed", item: { id: item.id, type: item.tool, status: item.status } };
  }
  const name = ACTION_ITEMS[item.type];
  if (!name) {
    if (NON_ACTION_ITEMS.has(item.type)) return null;
    throw Error(
      `bb reported the unknown item type ${JSON.stringify(item.type)}. Add it to ACTION_ITEMS or NON_ACTION_ITEMS in examples/bb/timeline.mjs so the run is not counted wrong.`,
    );
  }
  return {
    type: "item.completed",
    item: { id: item.id ?? `bb-item-${index}`, type: name, status: item.status },
  };
}

/**
 * Read metrics from bb's thread timeline. A timeline is JSONL: one event per line.
 *
 * bb exposes turn boundaries, tool items, and token usage. It exposes no cost, and no failed
 * tool call appeared in our runs, so cost and failed-call counts stay null instead of turning
 * an unobserved fact into zero.
 */
export function metricsFromTimeline(events) {
  const calls = [];
  const errors = [];
  let modelRounds = 0;
  let usage = null;
  for (const [index, event] of events.entries()) {
    if (event?.type === "turn/started") modelRounds += 1;
    if (event?.type === "turn/completed" && event.data?.status !== "completed") errors.push(event);
    if (event?.type === "item/completed") {
      const call = callFromItem(event.data?.item, index);
      if (call) calls.push(call);
    }
    if (event?.type === "thread/tokenUsage/updated") {
      const total = event.data?.tokenUsage?.total;
      if (total)
        usage = {
          input: total.inputTokens ?? null,
          output: total.outputTokens ?? null,
          cacheRead: total.cachedInputTokens ?? null,
          // bb totals input, cached input, and output, so its accounting has no cache-write part.
          cacheWrite: 0,
          totalTokens: total.totalTokens ?? null,
        };
    }
  }
  return {
    calls,
    toolCalls: calls.length,
    modelRounds,
    errors,
    eventCount: events.length,
    costUsd: null,
    inputTokens: usage?.input ?? null,
    outputTokens: usage?.output ?? null,
    cacheReadTokens: usage?.cacheRead ?? null,
    cacheWriteTokens: usage?.cacheWrite ?? null,
    totalTokens: usage?.totalTokens ?? null,
    failedToolCalls: null,
    invalidToolCalls: null,
  };
}

/** Parse the JSONL file the benchmark gives to `inspectOutput`. */
export async function inspectTimelineFile(file) {
  const events = [];
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return metricsFromTimeline(events);
}
