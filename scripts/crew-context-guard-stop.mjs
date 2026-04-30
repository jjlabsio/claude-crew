#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BYPASS_REASONS = [
  "context_limit",
  "context_window",
  "context_full",
  "max_tokens",
  "conversation_too_long",
  "abort",
  "cancel",
  "interrupt",
  "auth"
];

async function readStdin(timeoutMs = 3000) {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data || null), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data || null);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function pass() {
  return { continue: true };
}

function sessionId(event) {
  return String(event.session_id || event.sessionId || event.session?.id || "unknown")
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function reasonText(event) {
  return [
    event.stop_reason,
    event.stopReason,
    event.reason,
    event.error,
    event.message
  ].filter(Boolean).join(" ").toLowerCase();
}

function shouldBypass(event) {
  const text = reasonText(event);
  return BYPASS_REASONS.some((reason) => text.includes(reason));
}

function collectUsage(value, found = { inputTokens: null, contextWindow: null }) {
  if (!value || typeof value !== "object") return found;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      ["inputtokens", "inputtoken", "tokensinput", "totalinputtokens"].includes(normalized)
      && Number.isFinite(Number(nested))
    ) {
      found.inputTokens = Math.max(found.inputTokens ?? 0, Number(nested));
    }
    if (
      ["contextwindow", "contextwindowsize", "contextlimit", "maxcontexttokens"].includes(normalized)
      && Number.isFinite(Number(nested))
    ) {
      found.contextWindow = Math.max(found.contextWindow ?? 0, Number(nested));
    }
    collectUsage(nested, found);
  }

  return found;
}

function parseUsageFromText(text) {
  const inputMatches = [...text.matchAll(/"?(?:input_tokens|inputTokens|inputToken|total_input_tokens)"?\s*[:=]\s*(\d+)/gi)];
  const windowMatches = [...text.matchAll(/"?(?:context_window|contextWindow|context_limit|max_context_tokens)"?\s*[:=]\s*(\d+)/gi)];

  return {
    inputTokens: inputMatches.length > 0 ? Math.max(...inputMatches.map((match) => Number(match[1]))) : null,
    contextWindow: windowMatches.length > 0 ? Math.max(...windowMatches.map((match) => Number(match[1]))) : null
  };
}

async function usageFromTranscript(event) {
  const transcriptPath = event.transcript_path || event.transcriptPath;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { inputTokens: null, contextWindow: null };
  }

  try {
    const text = await readFile(transcriptPath, "utf8");
    return parseUsageFromText(text.slice(-128 * 1024));
  } catch {
    return { inputTokens: null, contextWindow: null };
  }
}

async function usageFor(event) {
  const fromEvent = collectUsage(event);
  const fromTranscript = await usageFromTranscript(event);
  return {
    inputTokens: fromEvent.inputTokens ?? fromTranscript.inputTokens,
    contextWindow: fromEvent.contextWindow ?? fromTranscript.contextWindow
  };
}

function counterPath(id) {
  return join(tmpdir(), `crew-stop-guard-${id}.json`);
}

async function readCount(id) {
  const path = counterPath(id);
  if (!existsSync(path)) return 0;
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    return Number(payload.count) || 0;
  } catch {
    return 0;
  }
}

async function writeCount(id, count) {
  await writeFile(
    counterPath(id),
    `${JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

function blockMessage(percent) {
  return [
    "Crew context guard: this session appears to be near the context window.",
    `Estimated usage: ${Math.round(percent)}%.`,
    "Run /compact before continuing so the crew workflow can checkpoint and preserve pending role, artifacts, and resume handles."
  ].join("\n");
}

async function main() {
  const raw = await readStdin();
  if (!raw) {
    console.log(JSON.stringify(pass()));
    return;
  }

  let event;
  try { event = JSON.parse(raw); } catch {
    console.log(JSON.stringify(pass()));
    return;
  }

  if (shouldBypass(event)) {
    console.log(JSON.stringify(pass()));
    return;
  }

  const { inputTokens, contextWindow } = await usageFor(event);
  if (!inputTokens || !contextWindow) {
    console.log(JSON.stringify(pass()));
    return;
  }

  const percent = (inputTokens / contextWindow) * 100;
  if (percent < 75 || percent >= 95) {
    console.log(JSON.stringify(pass()));
    return;
  }

  const id = sessionId(event);
  const count = await readCount(id);
  if (count >= 2) {
    console.log(JSON.stringify(pass()));
    return;
  }

  await writeCount(id, count + 1);
  const message = blockMessage(percent);
  console.log(JSON.stringify({
    continue: true,
    decision: "block",
    reason: message,
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: message
    }
  }));
}

main();
