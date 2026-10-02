# TICKET: lean-evidence-workflow

## Type
feat

## Goal
- Reduce unnecessary context and retries while requiring configured runtime smoke checks

## Scope
- Selective API context, evidence-based repair, Full smoke checks and regression tests

## Out of Scope
- No automatic releases, new SDKs, live paid requests or shared runtime provisioning

## Acceptance Criteria
- [x] Policies are preserved; repeated repair and failed smoke checks cannot pass Full verification

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Implementation Plan
1. Preserve full safety policies and select explicit ticket documents; expose a read-only context preview.
2. Require repair hypotheses, observed evidence and a distinguishing check; reject identical failed patches before application.
3. Run configured runtime smoke commands after Full checks; retain Quick and release approval boundaries.

## Test Plan
- Context budget, missing files, secret aliases, traversal and junction rejection.
- Initial implementation compatibility; repair evidence and duplicate failed patch rejection.
- Isolated HTTP smoke: start, fetch, assert and close; Full failure and Quick separation.
- Run all normal tests, lint, coverage, drift scan and task-bound offline Full verification.
- No paid API requests, live product data changes or release operations.

## Verification Evidence
- Final normal suite: 236 tests passed, none skipped; resumed failed-patch guard included.
- Task-bound offline Full: coverage thresholds and ESLint passed; drift scan clean.
- Live HTTP smoke and failure/Quick separation exercised in a disposable fixture.
- Ticket preview sample before evidence additions: focused 45,100 bytes vs full-context 50,404 bytes (10.5% smaller; not a billing estimate).
- Remote three-OS CI and paid provider behavior not tested in this task. No commit or push performed.

## Completion
- Completed At: 2026-10-02T12:52:41Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
