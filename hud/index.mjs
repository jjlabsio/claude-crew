#!/usr/bin/env node
/**
 * CREW HUD - Statusline for claude-crew plugin
 *
 * Displays:
 *   Top:    repo:<name> | branch:<branch> | model:<model>
 *   Middle: [CREW#x.y.z] ctx:<pct>% | agents:<n> | skill:<name> | session:<duration>
 *
 * Receives JSON on stdin from Claude Code.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const RESET = '\x1b[0m';
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const dim = (s) => `\x1b[2m${s}\x1b[22m`;
const yellow = (s) => `\x1b[33m${s}\x1b[39m`;
const red = (s) => `\x1b[31m${s}\x1b[39m`;
const green = (s) => `\x1b[32m${s}\x1b[39m`;
const cyan = (s) => `\x1b[36m${s}\x1b[39m`;
const magenta = (s) => `\x1b[35m${s}\x1b[39m`;

const SEPARATOR = dim(' | ');

// ---------------------------------------------------------------------------
// Read stdin (with timeout)
// ---------------------------------------------------------------------------
async function readStdin(timeoutMs = 1000) {
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
// Version
// ---------------------------------------------------------------------------
function getVersion() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    if (existsSync(pkgPath)) {
      return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
function gitExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

function getGitRepo(cwd) {
  // In worktrees, --show-toplevel returns the worktree path.
  // Use the remote origin URL to get the real repo name.
  const remoteUrl = gitExec('git remote get-url origin', cwd);
  if (remoteUrl) {
    // Handle both https and ssh formats
    const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  }
  // Fallback: use the main worktree (common dir) basename
  const commonDir = gitExec('git rev-parse --git-common-dir', cwd);
  if (commonDir) {
    // commonDir is like /path/to/repo/.git
    const repoDir = dirname(commonDir.replace(/\/.git$/, '') || commonDir);
    return basename(repoDir === '.' ? commonDir : commonDir.replace(/\/.git$/, ''));
  }
  const topLevel = gitExec('git rev-parse --show-toplevel', cwd);
  return topLevel ? basename(topLevel) : null;
}

function getGitBranch(cwd) {
  return gitExec('git rev-parse --abbrev-ref HEAD', cwd);
}

function hasUncommittedChanges(cwd) {
  const status = gitExec('git status --porcelain', cwd);
  return status ? status.length > 0 : false;
}

function hasUnpushedCommits(cwd) {
  const count = gitExec('git rev-list --count @{u}..HEAD', cwd);
  return count ? parseInt(count, 10) > 0 : false;
}

// ---------------------------------------------------------------------------
// Model name
// ---------------------------------------------------------------------------
function formatModel(stdin) {
  if (!stdin?.model) return null;
  const display = stdin.model.display_name || '';
  if (display) return display;
  // Fallback: parse from model id
  const id = stdin.model.id || '';
  if (id.includes('opus')) return 'Opus';
  if (id.includes('sonnet')) return 'Sonnet';
  if (id.includes('haiku')) return 'Haiku';
  return id;
}

// ---------------------------------------------------------------------------
// Context percentage
// ---------------------------------------------------------------------------
function getContextPercent(stdin) {
  if (!stdin?.context_window) return 0;
  if (stdin.context_window.used_percentage != null) {
    return Math.round(stdin.context_window.used_percentage);
  }
  if (stdin.context_window.current_usage && stdin.context_window.context_window_size) {
    const used = stdin.context_window.current_usage.input_tokens +
      (stdin.context_window.current_usage.cache_creation_input_tokens || 0) +
      (stdin.context_window.current_usage.cache_read_input_tokens || 0);
    return Math.round((used / stdin.context_window.context_window_size) * 100);
  }
  return 0;
}

function colorizeContext(pct) {
  const color = pct >= 85 ? red : pct >= 70 ? yellow : green;
  return `ctx:${color(`${pct}%`)}`;
}

// ---------------------------------------------------------------------------
// Transcript parsing (agents + skills)
// ---------------------------------------------------------------------------
function parseTranscript(transcriptPath) {
  const result = { agents: [], lastSkill: null, sessionStart: null };
  if (!transcriptPath || !existsSync(transcriptPath)) return result;

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Map of tool_use_id -> agent info
    const agentMap = new Map();
    let lastTimestamp = null;

    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      // Track last known timestamp
      if (entry.timestamp) {
        lastTimestamp = entry.timestamp;
      }

      // Session start time
      if (!result.sessionStart && entry.timestamp) {
        result.sessionStart = new Date(entry.timestamp);
      }

      // Track agents
      if (entry.type === 'tool_use' || entry.type === 'assistant') {
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              // Agent start
              if (block.name === 'Agent' || block.name === 'proxy_Agent') {
                const id = block.id;
                if (id) {
                  const input = block.input || {};
                  const agentType = input.subagent_type || input.type || 'general';
                  const model = input.model || null;
                  const description = input.description || input.prompt?.slice(0, 50) || '';
                  const ts = entry.timestamp || lastTimestamp;
                  agentMap.set(id, {
                    id,
                    type: agentType,
                    model,
                    description,
                    startTime: ts ? new Date(ts) : null,
                    status: 'running',
                  });
                }
              }
              // Skill invocation
              if (block.name === 'Skill' || block.name === 'proxy_Skill') {
                const skillName = block.input?.skill || block.input?.name;
                if (skillName) {
                  result.lastSkill = skillName;
                }
              }
            }
          }
        }
      }

      // Agent completion — tool_result can appear as a top-level entry
      // or inside a "user" message content array
      if (entry.type === 'tool_result') {
        const toolUseId = entry.tool_use_id;
        if (toolUseId && agentMap.has(toolUseId)) {
          agentMap.get(toolUseId).status = 'completed';
        }
      }
      if (entry.type === 'user') {
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const toolUseId = block.tool_use_id;
              if (toolUseId && agentMap.has(toolUseId)) {
                agentMap.get(toolUseId).status = 'completed';
              }
            }
          }
        }
      }
    }

    // Filter running agents, mark stale ones (>30min) as completed
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    const now = Date.now();
    result.agents = [...agentMap.values()].filter(a => {
      if (a.status !== 'running') return false;
      if (a.startTime && (now - a.startTime.getTime()) > STALE_THRESHOLD_MS) return false;
      return true;
    });
  } catch { /* ignore parse errors */ }

  return result;
}

// ---------------------------------------------------------------------------
// Agent model name (short)
// ---------------------------------------------------------------------------
function shortModelName(model) {
  if (!model) return '?';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return model;
}

// ---------------------------------------------------------------------------
// Agent duration formatting
// ---------------------------------------------------------------------------
function formatAgentDuration(startTime) {
  if (!startTime) return '?';
  const ms = Date.now() - startTime.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (seconds < 10) return '';
  if (seconds < 60) return `${seconds}s`;
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Agent multiline rendering
// ---------------------------------------------------------------------------
function renderAgentsMultiLine(agents, maxLines = 5) {
  if (agents.length === 0) return { headerPart: null, detailLines: [] };

  const headerPart = `agents:${cyan(String(agents.length))}`;

  // Sort by newest first
  const sorted = [...agents].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  const displayCount = Math.min(sorted.length, maxLines);
  const detailLines = [];

  sorted.slice(0, maxLines).forEach((a, index) => {
    const isLast = index === displayCount - 1 && sorted.length <= maxLines;
    const prefix = isLast ? '\u2514\u2500' : '\u251c\u2500';

    const name = a.type.padEnd(12);
    const model = shortModelName(a.model).padEnd(8);
    const duration = formatAgentDuration(a.startTime).padStart(4);
    const desc = a.description.length > 40 ? a.description.slice(0, 37) + '...' : a.description;

    detailLines.push(
      `${dim(prefix)} ${cyan(name)}${model}${dim(duration)}   ${desc}`
    );
  });

  if (sorted.length > maxLines) {
    const remaining = sorted.length - maxLines;
    detailLines.push(`${dim(`\u2514\u2500 +${remaining} more...`)}`);
  }

  return { headerPart, detailLines };
}

// ---------------------------------------------------------------------------
// Session duration
// ---------------------------------------------------------------------------
function formatDuration(startDate) {
  if (!startDate) return null;
  const ms = Date.now() - startDate.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h${remainMinutes}m`;
}

function colorizeSession(startDate) {
  if (!startDate) return `session:${green('0m')}`;
  const ms = Date.now() - startDate.getTime();
  const minutes = Math.floor(ms / 60000);
  const formatted = formatDuration(startDate);
  const color = minutes > 120 ? red : minutes > 60 ? yellow : green;
  return `session:${color(formatted)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw = await readStdin();
  if (!raw) {
    console.log('[CREW] no stdin');
    return;
  }

  let stdin;
  try { stdin = JSON.parse(raw); } catch {
    console.log('[CREW] invalid stdin');
    return;
  }

  const cwd = stdin.cwd || process.cwd();
  const version = getVersion();

  // --- Top line ---
  const topElements = [];

  const repo = getGitRepo(cwd);
  if (repo) topElements.push(`repo:${cyan(repo)}`);

  const branch = getGitBranch(cwd);
  if (branch) {
    const dirty = hasUncommittedChanges(cwd);
    const unpushed = hasUnpushedCommits(cwd);
    const branchDisplay = dirty ? `${branch}*` : branch;
    const branchColor = unpushed ? yellow : cyan;
    topElements.push(`branch:${branchColor(branchDisplay)}`);
  }

  const model = formatModel(stdin);
  if (model) topElements.push(`model:${cyan(model)}`);

  // --- Middle line ---
  const midElements = [];

  midElements.push(bold(`[CREW#${version}]`));

  const ctxPct = getContextPercent(stdin);
  midElements.push(colorizeContext(ctxPct));

  const transcript = parseTranscript(stdin.transcript_path);

  const { headerPart, detailLines } = renderAgentsMultiLine(transcript.agents);
  if (headerPart) {
    midElements.push(headerPart);
  }

  if (transcript.lastSkill) {
    midElements.push(`skill:${magenta(transcript.lastSkill)}`);
  }

  midElements.push(colorizeSession(transcript.sessionStart));

  // --- Output ---
  const outputLines = [];
  outputLines.push(topElements.join(SEPARATOR));
  outputLines.push(midElements.join(SEPARATOR));
  outputLines.push(...detailLines);

  console.log(outputLines.filter(Boolean).join('\n'));
}

main();
