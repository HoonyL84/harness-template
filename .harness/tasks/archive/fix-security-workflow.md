# TICKET: fix-security-workflow

## Type
fix

## Goal
- Restore the scheduled security scan and remove Node 20 action-runtime warnings.

## Scope
- Restore TruffleHog to the previously verified `v3.95.5` tag.
- Upgrade `actions/checkout` to v5 and `actions/setup-node` to v6.
- Run CI with Node.js 24.

## Out of Scope
- Changing audit policy or scan scheduling.
- Refactoring unrelated workflow steps.

## Acceptance Criteria
- [ ] Every referenced action tag exists upstream.
- [ ] Workflow YAML parses successfully.
- [ ] Full Harness verification passes.

## Risk
- Medium

## Notes
- Fixes the scheduled Security Scan failure observed on 2026-07-13.

## Completion
- Completed At: 2026-07-13T02:36:38Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
