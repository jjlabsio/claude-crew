#!/usr/bin/env node
/**
 * Delegation Enforcer — PreToolUse hook
 *
 * When an Agent/Task call includes subagent_type, auto-injects the model
 * from the matching agent definition (agents/*.md frontmatter).
 * If subagent_type is missing on an Agent/Task call, blocks with a warning.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { loadCatalog, loadProjectConfig, loadUserConfig } from '../scripts/lib/config.mjs';
import { loadContracts } from '../scripts/lib/contracts.mjs';
import { resolveRole } from '../scripts/lib/resolve.mjs';

// ---------------------------------------------------------------------------
// Read stdin
// ---------------------------------------------------------------------------
async function readStdin(timeoutMs = 3000) {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data || null), timeoutMs);
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data || null); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

// ---------------------------------------------------------------------------
// Load agent definitions from agents/*.md frontmatter
// ---------------------------------------------------------------------------
function loadAgentDefinitions(pluginRoot) {
  const agentsDir = join(pluginRoot, 'agents');
  const defs = {};

  try {
    const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(agentsDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const model = fm.match(/^model:\s*(.+)$/m)?.[1]?.trim();

      if (name && model) {
        defs[name] = model;
      }
    }
  } catch { /* ignore */ }

  return defs;
}

function resolveCrewRoleProvider(role) {
  return resolveRole({
    role,
    catalog: loadCatalog(),
    userConfig: loadUserConfig(),
    projectConfig: loadProjectConfig(),
    contracts: loadContracts()
  });
}

function blockCodexAgentCall(role, resolved) {
  return {
    continue: true,
    decision: 'block',
    reason: [
      `Role '${role}' is configured for Codex provider and cannot be called with the Agent tool.`,
      'Use the central runner prepare/dispatch path instead:',
      `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" prepare --role ${role} --request-file <request-file> --json`,
      `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" dispatch --role ${role} --request-file <request-file> --json`,
      `Resolved model: ${resolved.model}${resolved.reasoning ? ` / ${resolved.reasoning}` : ''}`
    ].join('\n')
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw = await readStdin();
  if (!raw) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  let event;
  try { event = JSON.parse(raw); } catch {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const toolName = (event.tool_name || '').toLowerCase();

  // Only intercept Agent/Task calls
  if (toolName !== 'agent' && toolName !== 'task') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const input = event.tool_input || {};

  // If subagent_type is missing, pass through without modification
  if (!input.subagent_type) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Canonicalize subagent_type (strip plugin prefix if present)
  const rawType = input.subagent_type.replace(/^claude-crew:/, '');
  let resolved = null;
  try {
    resolved = resolveCrewRoleProvider(rawType);
  } catch {
    resolved = null;
  }

  if (resolved?.provider === 'codex') {
    console.log(JSON.stringify(blockCodexAgentCall(rawType, resolved)));
    return;
  }

  if (resolved?.provider === 'claude' && !input.model && resolved.model) {
    console.log(JSON.stringify({
      continue: true,
      modifiedInput: { ...input, model: resolved.model },
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `model 자동 주입: ${rawType} → ${resolved.model}`,
      },
    }));
    return;
  }

  // Load agent definitions and auto-inject model if missing
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || dirname(import.meta.url.replace('file://', '')).replace('/hooks', '');
  const agentDefs = loadAgentDefinitions(pluginRoot);

  if (!input.model && agentDefs[rawType]) {
    // Auto-inject model from agent definition
    const injectedModel = agentDefs[rawType];
    console.log(JSON.stringify({
      continue: true,
      modifiedInput: { ...input, model: injectedModel },
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `model 자동 주입: ${rawType} → ${injectedModel}`,
      },
    }));
    return;
  }

  console.log(JSON.stringify({ continue: true }));
}

main();
