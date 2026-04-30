# Dev Log: Codex sandbox network access research

## Scope

- Investigated whether Codex CLI can allow network access in `workspace-write`.
- Checked sandbox modes available in the installed CLI.
- Identified practical workarounds for dependency installation workflows.
- Checked this repository's Codex dispatch path for whether it exposes network configuration.

## Evidence gathered

- Local CLI: `codex-cli 0.125.0`.
- `codex --help` and `codex exec --help` list sandbox modes: `read-only`, `workspace-write`, `danger-full-access`.
- `codex exec --help` lists `-c, --config <key=value>` for config overrides, but no dedicated `--network` flag.
- Official Codex docs state that default local `workspace-write` keeps network access off unless enabled with:

```toml
[sandbox_workspace_write]
network_access = true
```

- Official config reference documents `sandbox_workspace_write.network_access` as a boolean that allows outbound network access inside the `workspace-write` sandbox.
- Official sandbox docs state `danger-full-access` removes filesystem and network boundaries.
- Current repository dispatch path maps `workspace-write` roles to `--write` only:
  - `scripts/lib/dispatch.mjs`
  - `scripts/crew-codex-companion.mjs`
  - `scripts/crew-codex/lib/codex.mjs`
- No repository code path was found that passes `sandbox_workspace_write.network_access=true` to Codex or the app-server thread params.

## Findings

### 1. Codex CLI network allow option

There is no dedicated `--network` or `--allow-network` flag in the installed CLI help. The supported CLI mechanism is configuration:

```bash
codex exec \
  --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "run pnpm install and continue"
```

or persistent config:

```toml
# ~/.codex/config.toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

Docs:

- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/cli/reference

### 2. Other sandbox modes

Installed CLI modes:

- `read-only`: read-only / approval-oriented mode; not suitable for installs.
- `workspace-write`: workspace-scoped writes; network is off by default, but official docs say it can be enabled with `sandbox_workspace_write.network_access = true`.
- `danger-full-access`: no sandbox restrictions; network and filesystem boundaries are removed. Use only when the surrounding environment is already trusted or externally sandboxed.

Docs:

- https://developers.openai.com/codex/concepts/sandboxing

### 3. Workarounds for package installation

Recommended options, in descending safety order:

1. Enable network in `workspace-write` for the specific run:

```bash
codex exec \
  --sandbox workspace-write \
  --ask-for-approval never \
  -c sandbox_workspace_write.network_access=true \
  "install dependencies and run tests"
```

2. Persist the setting in a Codex profile:

```toml
[profiles.dev_with_net]
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = true
```

Then run:

```bash
codex exec --profile dev_with_net "install dependencies and continue"
```

3. Pre-install dependencies outside Codex, then run Codex with network disabled:

```bash
pnpm install
codex exec --sandbox workspace-write "implement and test using existing node_modules"
```

4. Use a package-manager cache or offline mirror:

```bash
pnpm fetch
codex exec --sandbox workspace-write "run pnpm install --offline and continue"
```

This only works when the lockfile and cache already contain every package.

5. Use `danger-full-access` only for trusted local runs or disposable VMs/containers:

```bash
codex exec --sandbox danger-full-access "install dependencies and continue"
```

or:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox "install dependencies and continue"
```

6. For Codex cloud, use setup-phase dependency installation or configure cloud internet access/domain allow lists. This is a different execution environment from local CLI sandboxing.

## Repository-specific note

The current `claude-crew` Codex integration does not expose network enablement. It maps dev/write work to `workspace-write` but does not pass `-c sandbox_workspace_write.network_access=true` or an equivalent app-server setting.

Practical repo-level follow-up:

- Add a `networkAccess` capability/config field.
- Extend dispatch/companion arguments to pass a Codex config override for CLI-backed execution, or update app-server thread params if the app-server protocol supports network policy in the installed Codex version.
- Keep default `false`; enable only for roles/tasks that need package installs.

## Verification

- Ran `codex --version`: `codex-cli 0.125.0`.
- Ran `codex --help` and `codex exec --help`; confirmed sandbox modes and config override flag.
- Searched repository for sandbox/network handling with `rg`.
- Reviewed relevant dispatch/companion source snippets.

## Remaining risks

- Platform behavior may differ. Recent public GitHub issues report inconsistent `network_access=true` behavior in some macOS App/Seatbelt and Windows/App paths, while the official docs define the intended CLI/config behavior.
- This run did not execute `pnpm install` with network because the current session itself is configured with network restrictions and approval is unavailable.
