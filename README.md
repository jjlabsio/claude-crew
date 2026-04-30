# Claude Crew

A Claude Code multi-agent orchestration plugin for solo SaaS developers.

[한국어](README.ko.md)

## Pipeline

```
crew-interview → crew-plan → crew-dev
   WHAT            HOW         DO
```

| Stage | Role | Output |
|-------|------|--------|
| **crew-interview** | What to build — requirements interview, product design | spec.md |
| **crew-plan** | How to build it — technical analysis, task decomposition | contract.md |
| **crew-dev** | Build it — implementation, code review, QA | working code + PR |

## Installation

In Claude Code:

```
/plugin marketplace add jjlabsio/claude-crew
/plugin install claude-crew
```

Or install locally:

```
/plugin install /path/to/claude-crew
```

## Initial Setup

Run once after installation:

```
/crew-setup
```

- `.gitignore` / `.gitattributes` migration (`.crew/` git tracked)
- HUD statusline installation
- Per-agent provider/model configuration

## Usage

### Development Pipeline

```
/crew
```

The orchestrator starts and briefs the current status.

### Quick Task Delegation

```
/crew-do "clean up login error messages"
/crew-do                         # runs the active task if one exists
```

`/crew-do` invokes the Dev agent in `direct` mode for small fixes, bug patches, and clearly scoped tasks. If Dev's default provider is Codex, code exploration, editing, and verification happen inside the Codex runtime; Claude handles only result summarization and follow-up coordination.

`/task` remains dedicated to memory/queue management. To execute a saved task, mark it active with `/task work {id}` then run `/crew-do`.

### Task Management

```
/task add "description"          # add a task (captures conversation context)
/task add "description" --next   # urgent — insert at top of queue
/task work 3                     # start working on task #3 (reads related files + briefs)
/task start                      # start working on the top-priority task
/task done                       # mark active task complete
/task bump 4                     # raise priority by one
/task top 7                      # move to top of queue
/task note 3 "note"              # add a note to a task
/task drop 3                     # delete a task

/tasks                           # project task board
/tasks stale                     # review tasks untouched for 30+ days
/tasks clean                     # clean up tasks completed 7+ days ago
```

Tasks are managed as individual files in `.crew/tasks/`. Each file carries state, priority, and context so work can resume across sessions without re-entering context.

## Agent Team

| Agent | Role | Used in |
|-------|------|---------|
| **Orchestrator** | Talks with the user, decides delegation, drives the pipeline | all |
| **Explorer** | Codebase exploration (read-only) | interview, plan |
| **Researcher** | External research (WebSearch) | interview, plan |
| **TechLead** | Technical analysis, architecture direction | plan |
| **Planner** | Task decomposition, implementation planning | plan |
| **PlanEvaluator** | Plan validation (hard thresholds) | plan |
| **Dev** | Code implementation | dev |
| **CodeReviewer** | Code review | dev |
| **QA** | Execution verification | dev |

## Two Modes

claude-crew is a **plugin installed into other projects**. It operates in two distinct modes.

### User Mode

General users who install this plugin into their own project for SaaS development.

- Slash commands to invoke directly: `/crew`, `/crew-setup`, `/crew-do`, `/task`, `/tasks`, `/crew-interview`, `/crew-plan`, `/crew-dev`.
- Debug command: `node scripts/crew-agent-runner.mjs resolve --role <role> --json` (shows combined provider/model/contract table).
- Works regardless of where the plugin is installed (`~/.claude/plugins/...` etc.) — the plugin script auto-detects its own location.

### Developer Mode

People developing claude-crew itself (working inside this repo).

- `node scripts/crew-agent-runner.mjs build`: derives `agents/{role}.md` + `plugin.json` agents array from contracts/instructions.
- `node scripts/crew-agent-runner.mjs validate`: checks build output against source files + sandbox consistency.
- `node scripts/crew-agent-runner.mjs install-hooks`: installs pre-commit hook (prevents drift).

These commands **only work inside the plugin source repo**. They are blocked when called from a user environment (detected via `.claude-plugin/plugin.json` + `package.json.name === "@jjlabsio/claude-crew"`).

## Model Configuration

Configure per-agent provider/model via `/crew-setup`. Agents without explicit configuration fall back to `agent_defaults` in `data/provider-catalog.json`.

Default recommendations are grouped by the nature of each agent's role:

| Agent | Provider | Model | Reasoning | Role type |
|-------|----------|-------|-----------|-----------|
| `techlead` | codex | gpt-5.5 | high | Judgment — architecture direction |
| `code-reviewer` | codex | gpt-5.5 | high | Judgment — code quality assessment |
| `pm` | codex | gpt-5.5 | medium | Planning — requirements gathering |
| `planner` | codex | gpt-5.5 | medium | Planning — implementation planning |
| `dev` | codex | gpt-5.5 | medium | Planning — code implementation |
| `plan-evaluator` | codex | gpt-5.4-mini | high | Execution — plan threshold checks |
| `qa` | codex | gpt-5.4-mini | high | Execution — build/test verification |
| `researcher` | codex | gpt-5.4-mini | high | Execution — external research |
| `explorer` | codex | gpt-5.3-codex-spark | low | Exploration — codebase search |

For Claude models, both latest aliases (`opus`, `sonnet`, `haiku`) and pinned version IDs like `claude-opus-4-7` are supported.

The Claude provider runs agents via Claude Code's `Agent` tool. The Codex provider runs via the bundled `scripts/crew-codex-companion.mjs` app-server runtime. When an agent needs to ask the user a question or invoke another agent, it does not handle this directly — the orchestrator takes over.

Regardless of provider, agent results are interpreted as one of: `complete`, `blocked_on_user`, `needs_agent`, `needs_tool`, or `failed`. Even when a Claude Code-specific tool is required, the Codex provider returns a request status and the orchestrator handles the actual tool execution.

## State Files

State is managed as Markdown files in the project-local `.crew/` directory (git tracked). Learning and state are preserved across plugin updates.

```
.crew/
  config.json          # provider configuration (gitignored)
  tasks/               # task files (one file per task)
  plans/               # pipeline artifacts (spec, contract, dev-log, review)
```

## Design Philosophy

**Preserve per-role perspective; do not restrict information.**

Each agent thinks from a specific viewpoint (product / technical / implementation), but the information it can use (including code) is not restricted. The goal is not to mimic real-world org chart separation, but to enforce structured thinking so no perspective is missed.

### Other Principles

- [Anthropic harness design article](https://www.anthropic.com/engineering/harness-design) is the primary reference
- Start as simple as possible; add complexity only when needed
- Remove components that become unnecessary as models improve

## License

MIT. This project also includes Apache-2.0 third-party components under `scripts/crew-codex/`; see `THIRD_PARTY_NOTICES.md`.
