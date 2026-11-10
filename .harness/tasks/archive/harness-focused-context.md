# TICKET: harness-focused-context

## Type
refactor

## Goal
- Preserve safety while reducing context, read-side writes, duplicated help and inline diagnostics

## Scope
- Separate mandatory safety from optional mode/stack context in central and project loaders.
- Keep query audit, omit derived history/followup writes for known read-only actions.
- Consolidate planning entry/help/docs, extract validate-* diagnostics without changing autonomy runtime.

## Out of Scope
- Personal files, deleting features, external API calls, publishing, commit/push/merge.
- Rewriting existing approvals, planning snapshots or external project documents.

## Acceptance Criteria
- [x] Required safety/explicit references stay fail-closed; central/external Node/Java and mode/review tests pass.
- [x] Queries preserve audit and do not regenerate events/followups or publish externally; mutations retain behavior.
- [x] Measure before/after bundle bytes and query write counts/bytes under identical fixtures.
- [x] Existing commands/exit codes preserved; focused, full suite, lint, Full and drift pass.

## Context Files
- docs/design-docs/safety-contract.md
- docs/PLANNING_QUALITY_GUIDE.md

## EXEC_PLAN
1. Capture baseline; split safety, mode and stack context; test managed scope and required-data failures.
2. Allowlist read actions in wrappers; test audit/failure/mutation effects and measure writes.
3. Keep canonical planning path and advanced help; link duplicate guide commands.
4. Extract diagnostic handlers with injected runtime dependencies; regression-test CLI behavior.
5. Run node tests/harness-cli/run.js, verify --full --task harness-focused-context, scan-drift.

## Risk
- medium

## Notes
- Created from harness CLI.

## Implementation and Verification
- Required safety-contract plus opt-in mode details; unknown/custom stack profiles stay conservative.
- Legacy external projects retain existing policies; managed central context excludes unrelated maintenance plans/tickets.
- Explicit query allowlist preserves success/failure audit. Mutations, notification retry and reconciliation retain capture.
- Concise default help; help --all retains commands. Guides link canonical planning/operation procedures.
- Six validate-* handlers and help moved out of index.js; autonomy runtime and production validators are unchanged.
- Baseline HEAD: 2d9b05c. Measured before this result note/roadmap update: default central context 45,583 -> 23,095 bytes (49.3% lower).
- Same loader options against this template: external Node 68,247 -> 44,325 bytes; Gradle 68,249 -> 47,033 bytes.
  These are repository snapshots, not a universal external-project savings claim. Legacy projects are not auto-migrated.
- Identical empty connected fixture: query JSON writes 5 -> 2; observed written bytes 931 -> 618.
  Audit ledger writes remain. This measures payload writes, not all filesystem I/O or network latency.
- index.js: 2,795 -> 2,585 lines. Existing commands remain compatible.
- Local evidence: observability/traces/focused-tests.log, focused-full.log; observability/metrics/focused-context-{before,after}.json.
- Full includes coverage, lint and memory lint. Prompt/recovery/API-retry CLI diagnostics, 10,000-cycle soak and drift passed.
- No live provider/Atlassian calls, external notifications, user-file cleanup, Git commit/push/merge or approval rewrites.
- Final human review/release remains pending; this ticket is not archived merely because local checks passed.

## Completion
- Completed At: 2026-11-10T14:10:36Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
