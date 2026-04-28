#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { loadContracts } from "./lib/contracts.mjs";
import {
  loadCatalog,
  loadProjectConfig,
  loadUserConfig
} from "./lib/config.mjs";
import { parseArgv } from "./lib/cli.mjs";
import { renderPrompt } from "./lib/render.mjs";
import { resolveRole } from "./lib/resolve.mjs";

function main(argv) {
  const { positional, flags } = parseArgv(argv);
  const command = positional[0];

  if (positional.length !== 1) {
    usage();
    return 2;
  }

  if (command === "render") {
    return renderCommand(flags);
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

function usage() {
  console.error("Usage: crew-agent-runner resolve --role <name> [--json]");
  console.error("       crew-agent-runner render --role <name> --request-file <path>");
}

const exitCode = main(process.argv.slice(2));
process.exitCode = exitCode;
