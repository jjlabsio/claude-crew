#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { build } from "./lib/build.mjs";
import { loadContracts } from "./lib/contracts.mjs";
import {
  loadCatalog,
  loadProjectConfig,
  loadUserConfig
} from "./lib/config.mjs";
import { parseArgv } from "./lib/cli.mjs";
import { dispatch, DispatchError } from "./lib/dispatch.mjs";
import { renderFollowup } from "./lib/renderFollowup.mjs";
import { renderPrompt } from "./lib/render.mjs";
import { resolveRole } from "./lib/resolve.mjs";
import { validate } from "./lib/validate.mjs";

async function main(argv) {
  const { positional, flags } = parseArgv(argv);
  const command = positional[0];

  if (positional.length !== 1) {
    usage();
    return 2;
  }

  if (command === "render") {
    return renderCommand(flags);
  }

  if (command === "dispatch") {
    return dispatchCommand(flags);
  }

  if (command === "render-followup") {
    return renderFollowupCommand(flags);
  }

  if (command === "build") {
    return buildCommand(flags);
  }

  if (command === "validate") {
    return validateCommand(flags);
  }

  if (command !== "resolve") {
    usage();
    return 2;
  }

  if (typeof flags.role !== "string" || flags.role.length === 0) {
    console.error("Missing required --role <name>");
    return 1;
  }

  try {
    const value = resolveRole({
      role: flags.role,
      catalog: loadCatalog(),
      userConfig: loadUserConfig(),
      projectConfig: loadProjectConfig(),
      contracts: loadContracts()
    });

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    } else {
      process.stdout.write(formatTable(value));
    }
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

async function buildCommand(flags) {
  if (
    flags.root !== undefined &&
    (typeof flags.root !== "string" || flags.root.length === 0)
  ) {
    console.error("Missing value for --root <path>");
    return 1;
  }

  try {
    await build({ root: flags.root ?? process.cwd() });
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

async function validateCommand(flags) {
  if (
    flags.root !== undefined &&
    (typeof flags.root !== "string" || flags.root.length === 0)
  ) {
    console.error("Missing value for --root <path>");
    return 1;
  }

  try {
    const result = await validate({ root: flags.root ?? process.cwd() });
    if (result.ok) {
      process.stdout.write("OK\n");
      return 0;
    }

    for (const error of result.errors) {
      console.error(error);
    }
    return 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

function renderFollowupCommand(flags) {
  if (
    typeof flags["previous-result"] !== "string" ||
    flags["previous-result"].length === 0
  ) {
    console.error("Missing required --previous-result <file>");
    return 1;
  }

  if (
    typeof flags["new-input"] !== "string" ||
    flags["new-input"].length === 0
  ) {
    console.error("Missing required --new-input <file>");
    return 1;
  }

  try {
    const previousResult = JSON.parse(
      readFileSync(flags["previous-result"], "utf8")
    );
    const newInput = readFileSync(flags["new-input"], "utf8");
    process.stdout.write(renderFollowup({ previousResult, newInput }));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

async function dispatchCommand(flags) {
  if (typeof flags.role !== "string" || flags.role.length === 0) {
    console.error("Missing required --role <name>");
    return 1;
  }

  if (
    typeof flags["request-file"] !== "string" ||
    flags["request-file"].length === 0
  ) {
    console.error("Missing required --request-file <path>");
    return 1;
  }

  if (
    flags["resume-handle"] !== undefined &&
    (typeof flags["resume-handle"] !== "string" ||
      flags["resume-handle"].length === 0)
  ) {
    console.error("Missing value for --resume-handle <thread-id>");
    return 1;
  }

  try {
    const contracts = loadContracts();
    const resolved = resolveRole({
      role: flags.role,
      catalog: loadCatalog(),
      userConfig: loadUserConfig(),
      projectConfig: loadProjectConfig(),
      contracts
    });
    const request = JSON.parse(readFileSync(flags["request-file"], "utf8"));
    const agentResult = await dispatch({
      role: flags.role,
      request,
      resolved,
      contract: resolved.contract,
      resumeHandle: flags["resume-handle"]
    });

    writeDispatchResult(agentResult, flags);
    if (agentResult.status === "failed") {
      console.error("Companion returned failed AgentResult.");
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof DispatchError && error.agentResult) {
      writeDispatchResult(error.agentResult, flags);
    }
    console.error(error.message);
    return error instanceof DispatchError ? error.exitCode : 1;
  }
}

function renderCommand(flags) {
  if (typeof flags.role !== "string" || flags.role.length === 0) {
    console.error("Missing required --role <name>");
    return 1;
  }

  if (
    typeof flags["request-file"] !== "string" ||
    flags["request-file"].length === 0
  ) {
    console.error("Missing required --request-file <path>");
    return 1;
  }

  try {
    const contracts = loadContracts();
    const contract = findContract(flags.role, contracts);
    if (!contract) {
      throw new Error(`Unknown role: ${flags.role}`);
    }

    const request = JSON.parse(readFileSync(flags["request-file"], "utf8"));
    process.stdout.write(
      renderPrompt({
        role: flags.role,
        request,
        contract
      })
    );
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

function formatTable(value) {
  const rows = [
    ["role", value.role],
    ["provider", value.provider],
    ["model", value.model],
    ["reasoning", value.reasoning ?? ""],
    ["codex_sandbox", value.codex_sandbox],
    ["dispatch.path", value.dispatch.path],
    ["dispatch.write", String(value.dispatch.write)]
  ];

  const keyWidth = Math.max(...rows.map(([key]) => key.length));
  return `${rows
    .map(([key, val]) => `${key.padEnd(keyWidth)}  ${val}`)
    .join("\n")}\n`;
}

function findContract(role, contracts) {
  return contracts.roles.find((contract) => contract.role === role);
}

function writeDispatchResult(agentResult, flags) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(agentResult, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${agentResult.summary ?? agentResult.status}\n`);
}

function usage() {
  console.error("Usage: crew-agent-runner resolve --role <name> [--json]");
  console.error("       crew-agent-runner build [--root <path>]");
  console.error("       crew-agent-runner validate [--root <path>]");
  console.error("       crew-agent-runner render --role <name> --request-file <path>");
  console.error(
    "       crew-agent-runner render-followup --previous-result <file> --new-input <file>"
  );
  console.error(
    "       crew-agent-runner dispatch --role <name> --request-file <path> [--json] [--resume-handle <thread-id>]"
  );
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
