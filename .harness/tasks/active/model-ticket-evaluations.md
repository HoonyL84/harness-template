# TICKET: model-ticket-evaluations

## Type
feat

## Goal
- 고정 티켓 사례의 공급자·모델별 opt-in 평가 및 품질·재시도·관측 토큰 비교

## Scope
- 안전한 기획/경계 평가 사례·로컬 결과·CLI·테스트·가이드

## Out of Scope
- 생성 코드 실행·실제 유료 호출·프로젝트 변경·Git 반영

## Acceptance Criteria
- [x] Fixed planning/context/approval cases and strict structural oracles.
- [x] Default dry-run, explicit live budget, capped retries and no generated command execution.
- [x] Atomic evidence, unknown usage handling, same-cohort comparison and fingerprint-bound human review.
- [x] 275 tests passed (0 failed, 0 skipped); offline Full coverage/lint passed.

## Risk
- 낮음

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. Fixed anonymized planning/context/approval cases -> strict structural oracle tests.
2. Provider-neutral bounded transport and dry-run CLI -> 3-provider request-shape and no-cost tests.
3. Atomic evidence, cohort comparison and fingerprint-bound human review -> interruption/budget/tamper tests.
4. Guide, regression and Full verification -> npm test; verify --full --offline --task model-ticket-evaluations.

## Release Boundary
- Preserve prior approved planning/context edits on the existing branch.
- No live paid requests, external account writes, generated command execution, commit, push or merge.

## Validation Evidence
- New eval suite: 14 tests passed, including 3-provider transport shapes, budget/API failure, interrupted evidence, tampering and junction protection.
- Complete repository suite: 275 passed, 0 failed, 0 skipped.
- CLI eval list and Gemini dry-run passed with api_calls=0.
- Full verification: coverage and lint passed; no product runtime smoke configured.
- All provider responses in tests were mocked. No paid/live requests, Jira/Confluence writes or Git release.
- Implementation is review-ready; actual model quality and repeated live reliability remain unmeasured.

## Follow-up Fix Plan
1. Malformed model fields are structural failures, not API errors -> oracle and whole-run retry regression.
2. Join all text response parts while excluding reasoning/tool blocks -> Anthropic/Gemini exact-output regression.
3. Append fingerprint-bound review history, retaining legacy single reviews -> repeated review, migration and tamper regression.
4. Update usage guide and validation evidence, then run repository tests and offline Full -> no paid calls or Git release.

## Follow-up Validation Evidence
- Red phase: all 5 new regression tests failed against the previous implementation.
- Green phase: eval suite 19 passed; complete repository suite 280 passed, 0 failed, 0 skipped.
- Invalid missing_context types remain structural failures, permit bounded retries and do not abort later cases.
- Anthropic/Gemini text parts are joined in order; reasoning/tool blocks and alternate candidates are excluded.
- Re-review history retains previous results and legacy single-review evidence; result fingerprints stay unchanged.
- API failure and post-response processing failure use separate status categories with sanitized errors.
- Final gate: verify --full --offline --task model-ticket-evaluations; completion status is recorded in the local verification ledger.
- No paid API requests, external account writes, commit, push or merge.
