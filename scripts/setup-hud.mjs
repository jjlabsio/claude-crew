#!/usr/bin/env node
/**
 * CREW Session Start Hook
 *
 * Writes statusLine to the project's .claude/settings.local.json so the HUD
 * only appears in projects where claude-crew is installed.
 * Also removes the legacy global statusLine from ~/.claude/settings.json.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Read stdin (with timeout)
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

function gitExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw = await readStdin();

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  let cwd = process.cwd();
  if (raw) {
    try { cwd = JSON.parse(raw).cwd || cwd; } catch { /* ignore */ }
  }

  // Use git toplevel as the reliable project root
  const projectRoot = gitExec('git rev-parse --show-toplevel', cwd) || cwd;

  const hudCommand = `node "${pluginRoot}/hud/index.mjs"`;
  const localSettingsPath = join(projectRoot, '.claude', 'settings.local.json');

  try {
    // --- Write statusLine to project-level settings.local.json ---
    let localSettings = {};
    if (existsSync(localSettingsPath)) {
      try { localSettings = JSON.parse(readFileSync(localSettingsPath, 'utf-8')); } catch { /* ignore */ }
    }

    if (localSettings.statusLine?.command !== hudCommand) {
      localSettings.statusLine = { type: 'command', command: hudCommand };
      mkdirSync(join(projectRoot, '.claude'), { recursive: true });
      writeFileSync(localSettingsPath, JSON.stringify(localSettings, null, 2));
    }

    console.log(JSON.stringify({ continue: true }));
  } catch (e) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `CREW HUD 자동 설정 실패: ${e.message}`,
      },
    }));
  }
}

main();
