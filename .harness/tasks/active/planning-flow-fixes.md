# TICKET: planning-flow-fixes

## Type
fix

## Goal
- Fix planning draft concurrency, Jira identity preservation, and review-ready notifications

## Scope
- Planning command, transition notifier, focused regression tests and usage guide

## Out of Scope
- Live provider calls, Jira publishing, unrelated files, commit/push/merge

## Acceptance Criteria
- [x] API responses cannot replace a draft created, revised or approved while awaiting the provider.
- [x] Revisions preserve the linked Jira source in both the plan and immutable evidence; identity changes fail closed.
- [x] Ready draft/generate results create deduplicated review alerts; dry-runs do not, and unresolved questions are distinguished.
- Final gate: targeted regressions, full tests, coverage/lint, Full verification and drift checks must pass. The current Full result is authoritative only with a matching content fingerprint.

## EXEC_PLAN
1. Add deterministic regression cases using temporary state and mocked providers/transports. Confirm the original failures.
2. Bind API saves to the request snapshot captured before the asynchronous call and retain Jira identity during normalization.
3. Map quality-planning results into the existing durable transition outbox, without replaying generation or publishing.
4. Run focused and full verification, inspect the diff, and leave implementation ready for user review.

## Context Files
- docs/PLANNING_QUALITY_GUIDE.md
- tools/harness-cli/planning-command.js
- tools/harness-cli/transition-notifier.js

## Risk
- medium

## Verification
- Red: all three focused regression cases failed against the original implementation.
- Green: focused planning/notification tests 27 passed, no failures or skips.
- Full test suite: 359 passed, no failures or skips (planning-flow-tests.log).
- CLI integration caught notification diagnostics contaminating JSON stdout; diagnostics now use stderr, with single/multi-project outbox assertions.
- Final gate command: node tools/harness-cli/index.js verify --full --task planning-flow-fixes.
- Full result: observability/metrics/planning-flow-fixes.verify.json; trace: observability/traces/planning-flow-full.log.
- Tests use temporary state and mocked providers/transports. Real-account delivery and paid model effectiveness are not claimed.

## Notes
- Approved follow-up to the main 9295633 self-review. Preserve all pre-existing personal files.
- No paid model requests, external Jira/Confluence writes, or Git release operations.
- Keep active until user review and release approval; do not archive implementation as a completed release.
