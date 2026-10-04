# TICKET: notification-project-prefix

## Type
fix

## Goal
- Show explicit project identity first in every Telegram and Slack managed notification

## Scope
- Notification formatter, transition and runner project metadata, tests and short guide

## Out of Scope
- No game code, unrelated publication changes, secret commits or automatic main merge

## Acceptance Criteria
- [x] Project headers are preserved for success, failure and retry, and Full verification passes

## Risk
- 낮음

## Notes
- Created from harness CLI.


## Execution Plan
1. Pass explicit project IDs from managed transitions and runner outcomes to the shared sender.
2. Prefix Telegram text and Slack titles/fallbacks; preserve unknown context without guessing.
3. Test project selection, local failure context, delivery retry and prefix injection rejection.
4. Run focused tests, plain suite, Full verification and separate live notices; commit and push only approved changes.

## Verification Evidence
- Focused notification/runner/control-plane tests: 34 passed, 0 failed, 0 skipped.
- ESLint passed; project names are explicit for success, failure, delivery retries and dashboard summaries.
- Full verification passed (coverage and lint). Plain suite including CLI smoke: 324 passed, 0 failed, 0 skipped.
- Telegram/Slack headers validated with mock delivery. Live messages require separate external-payload approval; no main merge is authorized.

## Completion
- Completed At: 2026-10-04T02:41:17Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
