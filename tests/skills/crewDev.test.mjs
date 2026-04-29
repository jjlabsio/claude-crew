import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { validateWorkflowSkillDispatchContract } from "../../scripts/lib/skillDispatchContract.mjs";

const SKILL_PATH = join(process.cwd(), "skills", "crew-dev", "SKILL.md");

const FORBIDDEN_PATTERNS = [
  /Agent\(/,
  /Bash\(/,
  new RegExp(["crew", "codex", "companion"].join("-")),
  /runAgent\(/,
  new RegExp(["AskUser", "Question"].join("")),
  new RegExp(`<${["crew", "agent", "result"].join("-")}>`)
];

const REQUIRED_ABSTRACT_FIELDS = [
  "role:",
  "inputs:",
  "output:",
  "role instructions:",
  "success gate:",
  "failure handling:"
];

const REQUIRED_PHASES = [
  "### Phase 1 — 환경 준비",
  "### Phase 2 — US 단위 증분 루프",
  "### Phase 3 — 최종 통합 검증",
  "### Phase 4 — PR + 완료"
];

const REQUIRED_FLOW_MARKERS = [
  "Phase 1a — provider 설정 해석",
  "Phase 1b — contract.md 검증",
  "Phase 1c — 워크트리 결정",
  "Phase 1d — 상태 갱신",
  "Phase 2a — US 목록 파싱",
  "Phase 2b Step 1 — Dev 실행",
  "Phase 2b Step 1a — crash 감지 + retry",
  "Phase 2b Step 2 — CodeReviewer + QA 병렬 검증",
  "Phase 2b Step 3 — 판정",
  "Phase 2b Step 4 — 체크포인트 commit",
  "Phase 2b Step 5 — FAIL 처리",
  "CodeReviewer",
  "QA",
  "crew-agent-runner"
];

function validateCrewDevSkill(text) {
  expect(validateWorkflowSkillDispatchContract(text, SKILL_PATH)).toEqual([]);

  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text, `${pattern} must not appear`).not.toMatch(pattern);
  }

  for (const phase of REQUIRED_PHASES) {
    const start = text.indexOf(phase);
    expect(start, `${phase} section is required`).toBeGreaterThanOrEqual(0);

    const next = text.indexOf("\n### Phase ", start + phase.length);
    const section = text.slice(start, next === -1 ? undefined : next);
    expect(section, `${phase} must use central runner dispatch`).toContain(
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다."
    );

    for (const field of REQUIRED_ABSTRACT_FIELDS) {
      expect(section, `${phase} must include ${field}`).toContain(field);
    }
  }

  for (const marker of REQUIRED_FLOW_MARKERS) {
    expect(text, `${marker} flow marker is required`).toContain(marker);
  }
}

describe("crew-dev skill", () => {
  test("uses phase-level abstract specs without direct dispatch patterns", async () => {
    const text = await readFile(SKILL_PATH, "utf8");

    validateCrewDevSkill(text);
  });

  test("detects a fixture with forbidden direct-dispatch patterns", () => {
    const fixture = [
      "### Phase 1 — 환경 준비",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: orchestrator",
      "inputs:",
      "- contract.md",
      "output:",
      "- initialized workspace",
      "role instructions:",
      "- Phase 1a — provider 설정 해석",
      "- Phase 1b — contract.md 검증",
      "- Phase 1c — 워크트리 결정",
      "- Phase 1d — 상태 갱신",
      "success gate:",
      "- ready",
      "failure handling:",
      "- block",
      "### Phase 2 — US 단위 증분 루프",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: Dev, CodeReviewer, QA",
      "inputs:",
      "- plan.md",
      "output:",
      "- per-US reports",
      "role instructions:",
      "- Phase 2a — US 목록 파싱",
      "- Phase 2b Step 1 — Dev 실행",
      "- Phase 2b Step 1a — crash 감지 + retry",
      "- Phase 2b Step 2 — CodeReviewer + QA 병렬 검증",
      "- Phase 2b Step 3 — 판정",
      "- Phase 2b Step 4 — 체크포인트 commit",
      "- Phase 2b Step 5 — FAIL 처리",
      "success gate:",
      "- all US pass",
      "failure handling:",
      "- preserve feedback loop",
      "### Phase 3 — 최종 통합 검증",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: CodeReviewer, QA",
      "inputs:",
      "- final diff",
      "output:",
      "- final reports",
      "role instructions:",
      "- final verification",
      "success gate:",
      "- both pass",
      "failure handling:",
      "- block",
      "### Phase 4 — PR + 완료",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: orchestrator",
      "inputs:",
      "- final reports",
      "output:",
      "- PR",
      "role instructions:",
      "- push and create PR",
      "success gate:",
      "- PR created",
      "failure handling:",
      "- block",
      ["run", "Agent("].join("")
    ].join("\n");

    expect(validateWorkflowSkillDispatchContract(fixture, SKILL_PATH)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/direct agent dispatch is forbidden/)
      ])
    );
    expect(() => validateCrewDevSkill(fixture)).toThrow();
  });
});
