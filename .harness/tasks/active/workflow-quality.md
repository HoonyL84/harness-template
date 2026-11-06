# TICKET: workflow-quality

## Type
feat

## Goal
- Deterministic compositional safety tests, planning evaluation rubric, safe recovery guidance and self-contained README

## Scope
- Existing runner/publication/release flow tests, planning eval fixtures, dashboard guidance, README

## Out of Scope
- Live API calls, remote publication, new CLI commands, broad refactoring, commit/push/merge

## Acceptance Criteria
- [x] Promise barriers reproduce concurrent runner entry without sleeps; attempts, owner lease and history remain intact.
- [x] Lost Jira acknowledgement followed by runner completion/flush never replays the uncertain transition or overwrites it with a newer state.
- [x] After human review and release approval, changed content or bound Jira inputs block Git effects; unrelated Jira metadata does not.
- [x] Planning fixtures distinguish structural failures from semantic human scoring; no vague-phrase denylist.
- [x] Dashboard and relevant failures use the same Why/Safe Next Action; uncertain state first points to inspection, not repair.
- [x] README explains actual architecture, workflow, setup, evidence, recovery, limits and module mapping without claiming semantic correctness.
- [x] Focused tests, full suite, lint, verify --full and scan-drift pass; no paid API, live publication or Git release.

## Risk
- medium

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. Extend existing operations-followup fixtures with deterministic cross-module scenarios; use real state files and mock external/Git/model adapters.
2. Add workflow-derived synthetic planning cases and explicit human rubric; preserve all existing mechanical guards and legacy evidence.
3. Share safe inspection guidance between dashboard, runner/release errors and publication advice, without adding commands or automatic recovery.
4. Rewrite README against actual code contracts, validate local links and run Full verification for this ticket.

## Verification
- node --test tests/harness-cli/operations-followup.test.js tests/harness-cli/operations-visibility.test.js tests/harness-cli/planning-quality.test.js
- node tests/harness-cli/run.js
- npm.cmd run lint
- node tools/harness-cli/index.js verify --full --task workflow-quality
- node tools/harness-cli/index.js scan-drift

## Constraints
- Preserve the 17 unrelated personal untracked files and all previous ticket/approval evidence.
- This ticket does not approve commit, push, merge or external publication.
- Mock workflow regressions are not production failure-rate or LLM quality measurements.

## Implementation Notes
- Reused operations-followup fixtures for concurrent runner + remotely applied/lost Jira acknowledgement + repeated flush, and runner -> human review -> approved release freshness checks.
- Added three workflow-derived synthetic cases to the existing six; semantic quality stays human-labelled, including structural PASS / human changes-requested regression coverage.
- Shared inspection advice across runner, dashboard, command errors and publication hooks; conditional reconcile instructions are separate from the first safe read.
- Expanded README as a standalone explanation with actual module links, setup, managed operation boundaries, local-state portability, costs and evidence limitations.
- No remote writes, paid provider calls, commit, push or merge are part of this implementation run.

## Release Authorization
- User approved committing and pushing this change on 2026-11-06; implementation scope exclusions above did not grant release authority.
- Local verification is separate from PR CI and main merge approval.
