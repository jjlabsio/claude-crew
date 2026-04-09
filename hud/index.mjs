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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

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
// Project installation info from installed_plugins.json
// ---------------------------------------------------------------------------
function getProjectInstallInfo(projectRoot) {
  try {
    const pluginsJsonPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
    if (!existsSync(pluginsJsonPath)) return null;
    const data = JSON.parse(readFileSync(pluginsJsonPath, 'utf-8'));
    const crewEntries = data.plugins?.['claude-crew@claude-crew'] || [];
    return crewEntries.find(e => e.projectPath === projectRoot) || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------
function getVersion(installInfo) {
  // Read from the project-specific install path
  if (installInfo?.installPath) {
    try {
      const pkgPath = join(installInfo.installPath, 'package.json');
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
      }
    } catch { /* ignore */ }
  }
  // Fallback to version field from install record
  if (installInfo?.version && installInfo.version !== 'unknown') {
    return installInfo.version;
  }
  // Final fallback: own package.json (dev/local run)
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
// Agent definitions (subagent_type → model)
// ---------------------------------------------------------------------------
function loadAgentModels() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const agentsDir = join(__dirname, '..', 'agents');
    const models = {};
    const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(agentsDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const model = fm.match(/^model:\s*(.+)$/m)?.[1]?.trim();
      if (name && model) models[name] = model;
    }
    return models;
  } catch { return {}; }
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
// Rate limits (5h / weekly)
// ---------------------------------------------------------------------------
function getRateLimits(stdin) {
  const rl = stdin?.rate_limits;
  if (!rl) return null;
  const parse = (v) => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isNaN(n) ? null : Math.round(Math.min(Math.max(n, 0), 100));
  };
  const parseResetAt = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return new Date(v * 1000);
  };
  const fiveHour = parse(rl.five_hour?.used_percentage);
  const sevenDay = parse(rl.seven_day?.used_percentage);
  const fiveHourResetAt = parseResetAt(rl.five_hour?.resets_at);
  const sevenDayResetAt = parseResetAt(rl.seven_day?.resets_at);
  if (fiveHour == null && sevenDay == null) return null;
  return { fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt };
}

function formatResetTime(resetAt) {
  if (!resetAt) return '';
  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return '';
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function colorizeRateLimits(limits) {
  if (!limits) return null;
  const colorize = (pct) => {
    const color = pct >= 85 ? red : pct >= 70 ? yellow : green;
    return color(`${pct}%`);
  };
  const formatWindow = (label, pct, resetAt) => {
    const reset = formatResetTime(resetAt);
    const resetStr = reset ? ` ${dim(`(${reset})`)}` : '';
    return `${label}:${colorize(pct)}${resetStr}`;
  };
  const parts = [];
  if (limits.fiveHour != null) parts.push(formatWindow('5h', limits.fiveHour, limits.fiveHourResetAt));
  if (limits.sevenDay != null) parts.push(formatWindow('weekly', limits.sevenDay, limits.sevenDayResetAt));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Transcript parsing (agents + skills)
// ---------------------------------------------------------------------------
function parseTranscript(transcriptPath) {
  const result = { agents: [], todos: [], lastSkill: null, sessionStart: null };
  if (!transcriptPath || !existsSync(transcriptPath)) return result;

  const agentModels = loadAgentModels();

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const agentMap = new Map();
    const latestTodos = [];
    const taskIdToIndex = new Map();
    let lastTimestamp = null;

    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (entry.timestamp) {
        lastTimestamp = entry.timestamp;
      }

      if (!result.sessionStart && entry.timestamp) {
        result.sessionStart = new Date(entry.timestamp);
      }

      // Process tool_use blocks from assistant messages
      if (entry.type === 'tool_use' || entry.type === 'assistant') {
        const blocks = entry.message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type !== 'tool_use') continue;

            // Agent start
            if (block.name === 'Agent' || block.name === 'proxy_Agent') {
              const id = block.id;
              if (id) {
                const input = block.input || {};
                const agentType = input.subagent_type || input.type || 'general';
                const rawType = agentType.replace(/^claude-crew:/, '');
                const model = input.model || agentModels[rawType] || null;
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

            // TodoWrite — full replacement of todo list
            if (block.name === 'TodoWrite') {
              const input = block.input || {};
              if (input.todos && Array.isArray(input.todos)) {
                const contentToTaskIds = new Map();
                for (const [taskId, idx] of taskIdToIndex) {
                  if (idx < latestTodos.length) {
                    const c = latestTodos[idx].content;
                    const ids = contentToTaskIds.get(c) ?? [];
                    ids.push(taskId);
                    contentToTaskIds.set(c, ids);
                  }
                }

                latestTodos.length = 0;
                taskIdToIndex.clear();
                latestTodos.push(...input.todos);

                for (let i = 0; i < latestTodos.length; i++) {
                  const ids = contentToTaskIds.get(latestTodos[i].content);
                  if (ids) {
                    for (const taskId of ids) {
                      taskIdToIndex.set(taskId, i);
                    }
                    contentToTaskIds.delete(latestTodos[i].content);
                  }
                }
              }
            }

            // TaskCreate — append a single task
            if (block.name === 'TaskCreate') {
              const input = block.input || {};
              const subject = typeof input.subject === 'string' ? input.subject : '';
              const description = typeof input.description === 'string' ? input.description : '';
              const todoContent = subject || description || 'Untitled task';
              const status = normalizeTaskStatus(input.status) ?? 'pending';
              latestTodos.push({ content: todoContent, status });

              const taskId = typeof input.taskId === 'string' || typeof input.taskId === 'number'
                ? String(input.taskId)
                : block.id;
              if (taskId) {
                taskIdToIndex.set(taskId, latestTodos.length - 1);
              }
            }

            // TaskUpdate — update status/content of existing task
            if (block.name === 'TaskUpdate') {
              const input = block.input || {};
              const index = resolveTaskIndex(input.taskId, taskIdToIndex, latestTodos);
              if (index !== null) {
                const status = normalizeTaskStatus(input.status);
                if (status) {
                  latestTodos[index] = { ...latestTodos[index], status };
                }
                const subject = typeof input.subject === 'string' ? input.subject : '';
                const description = typeof input.description === 'string' ? input.description : '';
                const newContent = subject || description;
                if (newContent) {
                  latestTodos[index] = { ...latestTodos[index], content: newContent };
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
          const agent = agentMap.get(toolUseId);
          agent.status = 'completed';
          const ts = entry.timestamp || lastTimestamp;
          if (ts) agent.endTime = new Date(ts);
        }
      }
      if (entry.type === 'user') {
        const blocks = entry.message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'tool_result') {
              const toolUseId = block.tool_use_id;
              if (toolUseId && agentMap.has(toolUseId)) {
                const agent = agentMap.get(toolUseId);
                agent.status = 'completed';
                const ts = entry.timestamp || lastTimestamp;
                if (ts) agent.endTime = new Date(ts);
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
    result.todos = [...latestTodos];
  } catch { /* ignore parse errors */ }

  return result;
}

// ---------------------------------------------------------------------------
// Todo helpers
// ---------------------------------------------------------------------------
function normalizeTaskStatus(status) {
  if (typeof status !== 'string') return null;
  switch (status) {
    case 'pending':
    case 'not_started':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    default:
      return null;
  }
}

function resolveTaskIndex(taskId, taskIdToIndex, latestTodos) {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const key = String(taskId);
    const mapped = taskIdToIndex.get(key);
    if (typeof mapped === 'number') return mapped;
    if (/^\d+$/.test(key)) {
      const numericIndex = parseInt(key, 10) - 1;
      if (numericIndex >= 0 && numericIndex < latestTodos.length) return numericIndex;
    }
  }
  return null;
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
function formatAgentDuration(startTime, endTime) {
  if (!startTime) return '';
  const ms = (endTime ?? new Date()).getTime() - startTime.getTime();
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins}m`;
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

    const rawType = a.type.includes(':') ? a.type.split(':').pop() : a.type;
    const name = rawType;
    const model = `[${shortModelName(a.model)}]`;
    const duration = formatAgentDuration(a.startTime, a.endTime);
    const desc = a.description.length > 40 ? a.description.slice(0, 37) + '...' : a.description;

    detailLines.push(
      `${dim(prefix)} ${cyan(name)} ${dim(model)} : ${desc} ${dim(`(${duration})`)}`
    );
  });

  if (sorted.length > maxLines) {
    const remaining = sorted.length - maxLines;
    detailLines.push(`${dim(`\u2514\u2500 +${remaining} more...`)}`);
  }

  return { headerPart, detailLines };
}

// ---------------------------------------------------------------------------
// Todo progress rendering
// ---------------------------------------------------------------------------
function renderTodosLine(todos) {
  if (!todos || todos.length === 0) return null;

  const inProgress = todos.find(t => t.status === 'in_progress');
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;

  if (!inProgress) {
    if (completed === total && total > 0) {
      return `${green('\u2713')} all done ${dim(`(${completed}/${total})`)}`;
    }
    return null;
  }

  const content = inProgress.content.length > 50
    ? inProgress.content.slice(0, 47) + '...'
    : inProgress.content;
  return `${yellow('\u25b8')} ${content} ${dim(`(${completed}/${total})`)}`;
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

  // Find git project root for reliable matching against installed_plugins.json
  const projectRoot = gitExec('git rev-parse --show-toplevel', cwd) || cwd;

  // Only show HUD if claude-crew is installed in this project
  const installInfo = getProjectInstallInfo(projectRoot);
  if (!installInfo) return;

  const version = getVersion(installInfo);

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

  const rateLimits = getRateLimits(stdin);
  const rateLimitsStr = colorizeRateLimits(rateLimits);
  if (rateLimitsStr) midElements.push(rateLimitsStr);

  // --- Todos line ---
  const todosLine = renderTodosLine(transcript.todos);

  // --- Output ---
  const outputLines = [];
  outputLines.push(topElements.join(SEPARATOR));
  outputLines.push(midElements.join(SEPARATOR));
  outputLines.push(...detailLines);
  if (todosLine) outputLines.push(todosLine);

  console.log(outputLines.filter(Boolean).join('\n'));
}

main();
