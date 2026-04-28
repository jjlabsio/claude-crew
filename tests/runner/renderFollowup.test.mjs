import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { renderFollowup } from "../../scripts/lib/renderFollowup.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function previousResultFixture() {
  return {
    status: "blocked_on_user",
    summary: "...",
    artifact: "..."
  };
}

describe("renderFollowup", () => {
  test("renders TS-7.1 followup prompt exactly", () => {
    const prompt = renderFollowup({
      previousResult: previousResultFixture(),
      newInput: "사용자 답변 X"
    });

    expect(prompt).toMatchSnapshot();
    expect(prompt).toBe(`## 이전 결과
status: blocked_on_user
summary: ...
artifact:
---
...
---

## 추가 입력
사용자 답변 X

## 지시
계속 진행해라.
`);
    expect(prompt.endsWith("\n")).toBe(true);
    expect(prompt.endsWith("\n\n")).toBe(false);
    expect(prompt.charCodeAt(0)).not.toBe(0xfeff);
  });

  test("is byte-identical for identical input", () => {
    const input = {
      previousResult: previousResultFixture(),
      newInput: "사용자 답변 X"
    };

    const first = renderFollowup(input);
    const second = renderFollowup(input);

    expect(second).toBe(first);
    expect(sha256(second)).toBe(sha256(first));
  });
});

describe("crew-agent-runner render-followup CLI", () => {
  test("prints followup prompt from previous result and new input files", async () => {
    tmpDir = await mkTmpDir();
    const previousResultPath = join(tmpDir, "previous-result.json");
    const newInputPath = join(tmpDir, "new-input.txt");
    await writeFile(
      previousResultPath,
      JSON.stringify(previousResultFixture()),
      "utf8"
    );
    await writeFile(newInputPath, "사용자 답변 X", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/crew-agent-runner.mjs",
        "render-followup",
        "--previous-result",
        previousResultPath,
        "--new-input",
        newInputPath
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      renderFollowup({
        previousResult: previousResultFixture(),
        newInput: "사용자 답변 X"
      })
    );
  });

  test("TS-7.2 exits non-zero when previous-result file is missing", async () => {
    tmpDir = await mkTmpDir();
    const previousResultPath = join(tmpDir, "missing.json");
    const newInputPath = join(tmpDir, "new-input.txt");
    await writeFile(newInputPath, "사용자 답변 X", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/crew-agent-runner.mjs",
        "render-followup",
        "--previous-result",
        previousResultPath,
        "--new-input",
        newInputPath
      ],
      { encoding: "utf8" }
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/ENOENT/);
    expect(result.stderr).toContain(previousResultPath);
  });
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
