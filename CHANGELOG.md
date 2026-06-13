# Changelog

All notable changes to this Harness template are documented in this file.

## 1.0.0 - 2026-06-14

- Added opt-in multi-agent orchestration with isolated worker worktrees and approval gates.
- Added Quick/Full verification, Git preflight, safe cleanup, recovery diagnostics, and L5 soak tests.
- Added Windows, macOS, and Linux CI coverage with pinned TruffleHog security scanning.
- Split orchestration state and budget management into a dedicated tested module.
- Added ESLint and enforced minimum Node test coverage thresholds.

## 2026-04-30

- Added `.editorconfig` with UTF-8 and line-ending defaults.
- Added `scripts/health-check.sh` for structural and verify-signal checks.
- Added `scripts/load-context.sh` and integrated auto-context injection into `scripts/run-agent.sh`.
- Added offline mode to `scripts/verify-task.sh` (`--offline` / `HARNESS_OFFLINE`).
- Added scaffold guidance comments to `tools/registry.yaml`.
- Rewrote `README.md` with UTF-8-safe Korean/English guidance.
- Added memory governance docs and templates.
- Added standardized `skills/<skill_name>/` scaffold with `SKILL.md`, `examples.jsonl`, `allowlist.yaml`.
- Added CI harness governance job and PR template quality gates.
