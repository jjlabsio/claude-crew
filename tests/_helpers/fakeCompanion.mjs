#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const response = process.env.FAKE_COMPANION_RESPONSE ?? "complete";
const logPath = process.env.FAKE_COMPANION_LOG;
const args = process.argv.slice(2);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function writeLog(extra = {}) {
  if (!logPath) {
    return;
  }

  const promptFile = readOption("--prompt-file");
  appendFileSync(
    logPath,
    `${JSON.stringify({
      args,
      promptFile,
      prompt: promptFile ? readFileSync(promptFile, "utf8") : null,
      ...extra
    })}\n`,
    "utf8"
  );
}

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

if (args[0] === "task-resume-candidate") {
  writeLog({ command: "task-resume-candidate" });
  if (response === "resumeMissing") {
    output({ available: false, candidate: null });
  } else {
    output({
      available: true,
      candidate: {
        id: "task_fake",
        status: "complete",
        title: "Codex Task",
        summary: "Task",
        threadId: "thread-resume-123",
        completedAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z"
      }
    });
  }
} else if (args[0] === "task") {
  writeLog({ command: "task" });
  if (response === "failed") {
    output(
      {
        status: 1,
        threadId: "thread-failed-123",
        rawOutput: "failed",
        crewAgentResult: {
          status: "failed",
          artifact: null,
          questions: [],
          requests: [],
          summary: "Fake companion failed",
          error: "boom"
        },
        crewAgentResultError: null
      },
      1
    );
  } else if (response === "crewAgentResultError") {
    output(
      {
        status: 1,
        threadId: "thread-error-123",
        rawOutput: "not json",
        crewAgentResult: null,
        crewAgentResultError: "Missing <crew-agent-result> block."
      },
      1
    );
  } else {
    output({
      status: 0,
      threadId: response === "resumeCandidate" ? "thread-resume-123" : "thread-complete-123",
      rawOutput: "complete",
      crewAgentResult: {
        status: "complete",
        artifact: { path: ".crew/plans/task-123/dev-log.md" },
        questions: [],
        requests: [],
        summary: "Fake companion completed",
        error: null
      },
      crewAgentResultError: null
    });
  }
} else {
  writeLog({ command: "unknown" });
  process.stderr.write(`Unknown fake companion command: ${args[0] ?? ""}\n`);
  process.exitCode = 1;
}
