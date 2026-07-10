# TICKET: cli-entrypoint-coverage

## Type
test

## Goal
- Reduce repeated verification work while preserving Full verification as the only completion gate.

## Scope
- Remove duplicate Node verification aliases.
- Cache successful Quick verification by repository content, commands, Node version, OS, and architecture.
- Cover extracted CLI entrypoint metadata with unit tests and real process smoke tests.
- Allow explicitly selected independent npm scripts to run in parallel during Full verification.

## Out of Scope
- Caching or weakening Full verification.
- Automatically guessing which project scripts are safe to parallelize.

## Acceptance Criteria
- [x] Duplicate npm script aliases execute once.
- [x] Quick cache hits only for identical content, commands, and runtime.
- [x] Full verification remains uncached and required for task completion.
- [x] Parallel execution is disabled by default and requires an explicit allowlist.
- [x] Unit tests, lint, coverage, and the final Full verification pass.

## Risk
- Medium

## Notes
- Performance options must fail safely and remain cross-platform.

## Completion
- Completed At: 2026-07-10T10:36:50Z
- Verify Result: pass
- Rework Count: 1
- Last Failure: Node coverage: ERROR: Coverage for lines (37.4%) does not meet global threshold (65%)
