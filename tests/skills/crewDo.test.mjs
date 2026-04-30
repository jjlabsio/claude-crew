import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { validateWorkflowSkillDispatchContract } from "../../scripts/lib/skillDispatchContract.mjs";

const SKILL_PATH = join(process.cwd(), "skills", "crew-do", "SKILL.md");

describe("crew-do skill", () => {
  test("delegates direct work through the existing dev role", async () => {
    const text = await readFile(SKILL_PATH, "utf8");

    expect(validateWorkflowSkillDispatchContract(text, SKILL_PATH)).toEqual([]);
    expect(text).toContain("기존 `dev` role 하나만 사용");
    expect(text).toContain('"role": "dev"');
    expect(text).toContain('"mode": "direct"');
    expect(text).toContain("/task`: 기억과 queue 관리 전용");
    expect(text).not.toContain("codex-worker");
    expect(text).not.toContain("--delegate");
  });
});
