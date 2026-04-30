import { mkdir, writeFile } from "node:fs/promises";
import { dirname, normalize, resolve, relative } from "node:path";

export class ArtifactPersistError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactPersistError";
  }
}

export async function persistCrewArtifact({ workspaceRoot, contract, request, agentResult }) {
  if (!shouldPersist(contract, agentResult)) {
    return null;
  }

  const target = findArtifactTarget(contract);
  if (!target) {
    return null;
  }

  const resolvedTarget = resolveTemplateTarget(target, request);
  const absolutePath = validateTargetPath(workspaceRoot, resolvedTarget);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, agentResult.artifact, "utf8");

  return absolutePath;
}

function shouldPersist(contract, agentResult) {
  if (contract?.capabilities?.workspaceAccess !== "read-only") {
    return false;
  }

  if (agentResult?.status !== "complete") {
    return false;
  }

  if (typeof agentResult.artifact !== "string" || agentResult.artifact.length === 0) {
    return false;
  }

  return true;
}

function findArtifactTarget(contract) {
  const outputs = Array.isArray(contract?.outputs) ? contract.outputs : [];
  for (const output of outputs) {
    if (
      output?.type === "artifact" &&
      typeof output.target === "string" &&
      output.target.startsWith(".crew/")
    ) {
      return output.target;
    }
  }
  return null;
}

function resolveTemplateTarget(target, request) {
  const values = {
    "task-id": firstString(request?.taskId, request?.task_id, request?.["task-id"]),
    "run-id": firstString(request?.runId, request?.run_id, request?.["run-id"])
  };

  const resolved = target.replace(/\{(task-id|run-id)\}/g, (match, name) => {
    const value = values[name];
    return value ?? match;
  });

  const unresolved = resolved.match(/\{[^}/\\]+\}/);
  if (unresolved) {
    throw new ArtifactPersistError(
      `Unresolved template variable ${unresolved[0]} in artifact target: ${target}`
    );
  }

  return resolved;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function validateTargetPath(workspaceRoot, target) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new ArtifactPersistError("workspaceRoot is required.");
  }

  const normalized = normalize(target);

  if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    throw new ArtifactPersistError(`Absolute path rejected: ${target}`);
  }

  const crewBase = resolve(workspaceRoot, ".crew");
  const absolutePath = resolve(workspaceRoot, normalized);
  const rel = relative(crewBase, absolutePath);

  if (rel.startsWith("..") || rel === "") {
    throw new ArtifactPersistError(
      `Target path escapes .crew/ directory: ${target}`
    );
  }

  return absolutePath;
}
