import { fenceBlock } from "./render.mjs";

export function renderFollowup({ previousResult, newInput } = {}) {
  return [
    "## 이전 결과",
    `status: ${normalizeInline(previousResult?.status)}`,
    `summary: ${normalizeInline(previousResult?.summary)}`,
    "artifact:",
    fenceBlock(serializeArtifact(previousResult?.artifact)),
    "",
    "## 추가 입력",
    normalizeBlock(newInput),
    "",
    "## 지시",
    "계속 진행해라."
  ].join("\n") + "\n";
}

function serializeArtifact(artifact) {
  if (artifact === undefined || artifact === null) {
    return "";
  }

  if (typeof artifact === "string") {
    return artifact;
  }

  return JSON.stringify(artifact, null, 2);
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
