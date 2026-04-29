# Changelog

All notable changes to this Harness template are documented in this file.

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
