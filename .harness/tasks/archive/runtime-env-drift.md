# TICKET: runtime-env-drift

## Type
fix

## Goal
- Prevent Node tooling runtime variables from being reported as user configuration drift.

## Scope
- Centralize runtime-managed environment variable detection.
- Ignore `NODE_V8_COVERAGE` during Config Drift scanning.
- Add a focused regression test.

## Out of Scope
- Weakening checks for Harness or application-owned environment variables.

## Acceptance Criteria
- [x] `NODE_V8_COVERAGE` is treated as runtime-managed.
- [x] Harness-owned variables still require `.env.template` declarations.
- [x] Drift scan and Full verification pass.

## Risk
- Low

## Notes
- Fixes the Harness Governance failure in PR #26.

## Completion
- Completed At: 2026-07-10T10:46:11Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
