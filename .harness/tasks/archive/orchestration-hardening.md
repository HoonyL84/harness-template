# TICKET: orchestration-hardening

## Type
test

## Goal
- Bind provider-role execution to persistent API-call and runtime budgets.
- Verify the multi-writer lifecycle with real temporary Git branches and worktrees.

## Scope
- Persist orchestration budget usage in state.
- Fail closed before provider calls when API or runtime budget is exhausted.
- Add a real Git E2E test for worker preparation, commit-bound verification, and integration.
- Document the shared L5 budget behavior.

## Out of Scope
- Provider billing estimation.
- Automatic worker implementation.
- Refactoring the orchestration module.

## Acceptance Criteria
- [ ] Provider planning and review calls consume one shared persistent request budget.
- [ ] Failed provider calls still consume budget.
- [ ] Runtime expiry blocks further mutating orchestration progress.
- [ ] Status and recovery diagnostics remain available after budget exhaustion.
- [ ] A temporary Git repository test creates two isolated worker worktrees.
- [ ] Worker commits require matching full verification records.
- [ ] Integration cherry-picks both verified workers and produces the expected files.
- [ ] Unit tests, Full verify, and Windows smoke pass.

## Risk
- Medium: real Git E2E cleanup must never touch the working repository.

## Completion
- Completed At: 2026-06-13T11:39:10Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
