import { fenceBlock } from "./render.mjs";

export function renderFollowup({ previousResult, newInput } = {}) {
  return [
    "## 이전 결과",
    `status: ${normalizeInline(previousResult?.status)}`,
    `summary: ${normalizeInline(previousResult?.summary)}`,
    "artifact:",
    fenceBlock(previousResult?.artifact),
    "",
    "## 추가 입력",
    normalizeBlock(newInput),
    "",
    "## 지시",
    "계속 진행해라."
  ].join("\n") + "\n";
}

function normalizeInline(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ");
}

function normalizeBlock(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "");
}
