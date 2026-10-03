# TICKET: context-reference-selection

## Type
feat

## Goal
- 승인된 티켓의 문서·섹션 참조와 누락·변경·Confluence 캐시 노후화 차단

## Scope
- 중앙 티켓·컨텍스트 번들·실행 결속·회귀 테스트·가이드

## Out of Scope
- 벡터 DB·그래프 런타임·실계정 게시·커밋·푸시

## Acceptance Criteria
- [x] 명시 참조·섹션·해시·누락·예산·심볼릭 링크·Confluence 버전/노후화·승인 결속·대화형/API 경계 회귀 테스트
- [x] 전체 테스트 261개 통과 (실패/스킵 0)
- [x] 최종 Full 검증 통과 (coverage + lint, offline)

## Risk
- 낮음

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. context_refs normalization and plan/execution binding -> malformed input and tampering tests.
2. Exact document/section selection; core rules retained -> bounded bundle, missing/hash/section/link tests.
3. Confluence version/age checks and retry fail-fast -> isolated snapshot and runner tests.
4. CLI preview, guide, regression and Full verification -> npm test and verify --full --offline --task context-reference-selection.

## Release Boundary
- Continue on the existing work branch; preserve prior planning-ticket edits.
- No real account writes, paid API calls, commit, push or merge.

## Validation Evidence
- npm test: 261 passed, 0 failed, 0 skipped.
- Real temporary Git/worktree fixtures; model, notification and Confluence responses are mocked.
- No real account writes, paid model requests or Git release.
- Explicit Confluence refs validate cached version and fetch age, not the live server latest version.
- Full verification passed; implementation is review-ready. Ticket completion and Git release remain pending user approval.
