import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SKILL_PATH = join(
  process.cwd(),
  "skills",
  "crew-agent-runner",
  "SKILL.md"
);

const REQUIRED_HEADERS = [
  "## Dispatch 절차",
  "## AgentResult 상태 처리",
  "## Resume",
  "## Followup 주입"
];

const REQUIRED_STATUSES = [
  "complete",
  "blocked_on_user",
  "needs_agent",
  "needs_tool",
  "failed"
];

function validateCrewAgentRunnerSkill(text) {
  for (const header of REQUIRED_HEADERS) {
    expect(text, `${header} section is required`).toContain(header);
  }

  for (const status of REQUIRED_STATUSES) {
    expect(text, `${status} status must be documented`).toContain(status);
  }

  expect(text, "Codex resume path subsection is required").toContain(
    "### Codex 경로"
  );
  expect(text, "Claude resume path subsection is required").toContain(
    "### Claude 경로"
  );
  expect(text, "Codex resume must use runner dispatch resume wrapper").toContain(
    "dispatch --role <role> --request-file <new-request-with-followup-prompt> --resume-handle <agent_handle> --json"
  );
  expect(
    text,
    "Codex resume must warn against direct companion calls"
  ).toContain(
    "직접 `crew-codex-companion.mjs task --resume-last`를 호출하지 말 것"
  );
  expect(text, "Codex resume must not instruct direct companion execution").not.toContain(
    "`node scripts/crew-codex-companion.mjs task --resume-last"
  );
  expect(text, "companion does not accept explicit thread ids").not.toMatch(
    /--resume\s+<thread-id>/
  );
}

describe("crew-agent-runner skill", () => {
  test("exists and documents dispatch, status handling, resume and followup", async () => {
    const text = await readFile(SKILL_PATH, "utf8");

    validateCrewAgentRunnerSkill(text);
  });

  test("detects a fixture missing the Resume section", () => {
    const fixture = `---
name: crew-agent-runner
description: fixture
---

## Dispatch 절차
### Codex 경로
### Claude 경로

## AgentResult 상태 처리
complete blocked_on_user needs_agent needs_tool failed

## Followup 주입
dispatch --role <role> --request-file <new-request-with-followup-prompt> --resume-handle <agent_handle> --json
직접 \`crew-codex-companion.mjs task --resume-last\`를 호출하지 말 것
`;

    expect(() => validateCrewAgentRunnerSkill(fixture)).toThrow(
      /## Resume section is required/
    );
  });
});
