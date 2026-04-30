# Result: Codex sandbox network access research

## Summary

Codex CLI does support network access for `workspace-write`, but not through a dedicated `--network` flag. The supported mechanism is config:

```toml
[sandbox_workspace_write]
network_access = true
```

For one-off runs, pass it with `-c`:

```bash
codex exec \
  --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "run pnpm install and continue"
```

Official docs:

- Agent approvals/security: https://developers.openai.com/codex/agent-approvals-security
- Config reference: https://developers.openai.com/codex/config-reference
- CLI reference: https://developers.openai.com/codex/cli/reference
- Sandboxing overview: https://developers.openai.com/codex/concepts/sandboxing

## 1. Codex CLI network option

Findings:

- Installed CLI version: `codex-cli 0.125.0`.
- `codex exec --help` exposes `-c, --config <key=value>`.
- It does not expose a dedicated `--network` / `--allow-network` option.
- Official docs say local `workspace-write` keeps network off by default unless enabled by config:

```toml
[sandbox_workspace_write]
network_access = true
```

Usable command:

```bash
codex exec \
  --sandbox workspace-write \
  --ask-for-approval never \
  -c sandbox_workspace_write.network_access=true \
  "pnpm install && pnpm test"
```

## 2. Sandbox modes

The CLI lists three modes:

- `read-only`: inspect-only by default; not useful for dependency installation.
- `workspace-write`: workspace-scoped writes; network off by default, configurable with `sandbox_workspace_write.network_access=true`.
- `danger-full-access`: removes sandbox restrictions, including filesystem and network boundaries.

So the practical network-capable choices are:

- Safer: `workspace-write` + `sandbox_workspace_write.network_access=true`.
- Broad access: `danger-full-access`.

## 3. Practical workarounds

Recommended order:

1. One-off network-enabled `workspace-write`:

```bash
codex exec --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "install dependencies and continue"
```

2. Persistent profile:

```toml
[profiles.dev_with_net]
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = true
```

3. Install outside Codex, then run Codex normally:

```bash
pnpm install
codex exec --sandbox workspace-write "continue using installed deps"
```

4. Use offline cache/mirror:

```bash
pnpm fetch
codex exec --sandbox workspace-write "pnpm install --offline && pnpm test"
```

5. Use `danger-full-access` only in a trusted/disposable environment:

```bash
codex exec --sandbox danger-full-access "pnpm install && pnpm test"
```

## claude-crew integration note

This repository currently maps dev/write work to `workspace-write` but does not expose network enablement. I found `--write` handling in `scripts/lib/dispatch.mjs` and `workspace-write` thread setup in `scripts/crew-codex-companion.mjs` / `scripts/crew-codex/lib/codex.mjs`, but no `sandbox_workspace_write.network_access=true` override.

To support package installs through `claude-crew`, add an explicit network opt-in field and pass it into Codex as a config override or app-server network policy, keeping the default disabled.

## Verification

- `codex --version`: `codex-cli 0.125.0`.
- `codex --help` / `codex exec --help`: confirmed sandbox modes and config override support.
- Repository search confirmed current runner only distinguishes read-only vs workspace-write.

## Remaining risks

Some recent public GitHub issues report platform-specific mismatches, especially Codex App/macOS Seatbelt behavior. The documented CLI behavior is clear, but each target machine should verify with:

```bash
codex exec --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "node -e \"fetch('https://registry.npmjs.org').then(r=>console.log(r.status))\""
```
