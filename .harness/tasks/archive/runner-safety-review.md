# TICKET: runner-safety-review

## Goal
- Close central runner patch, verification drift, and interrupted verification gaps.

## Scope
- Share configured L5 path restrictions with the runner; stop risky patches before application.
- Bind verification to unchanged pre/post content in both central execution paths.
- Recover expired verification leases only when their owner is no longer running.

## Acceptance Criteria
- Protected and high-risk patch regression tests pass.
- Mutations during verification cannot become REVIEW_READY.
- Dead verification owners recover to PREPARED; live owners retain their lease.
- Full verification passes.

## Release
- No main merge or release performed as part of the local repair.

## Verification
- Targeted regression suite: 18 passed, no skips.
- Full verification command: npm run harness -- verify --full --task runner-safety-review
- Legacy verification leases without owner metadata require manual inspection.

## Completion
- Completed At: 2026-09-07T22:05:55Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
