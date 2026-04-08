#!/usr/bin/env node
/**
 * CREW Session Start Hook
 *
 * Checks if statusLine is configured for CREW HUD.
 * If not, automatically sets it up.
 * Reads stdin JSON from Claude Code (SessionStart hook input).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Consume stdin (required by hook protocol)
  await readStdin();

  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const settingsPath = join(configDir, 'settings.json');
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  if (!pluginRoot) {
    // Not running as a plugin — skip
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const hudCommand = `node "${pluginRoot}/hud/index.mjs"`;

  try {
    let settings = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    }

    // Check if statusLine is already set to the *current* plugin path
    const currentCommand = settings.statusLine?.command || '';
    if (currentCommand === hudCommand) {
      // Already configured with this exact version
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Set statusLine to crew HUD
    settings.statusLine = {
      type: 'command',
      command: hudCommand,
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'CREW HUD가 자동 설정되었습니다. 다음 세션부터 statusline에 표시됩니다.',
      },
    }));
  } catch (e) {
    // Non-fatal — don't block session start
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `CREW HUD 자동 설정 실패: ${e.message}. /crew-setup을 수동 실행해주세요.`,
      },
    }));
  }
}

main();
