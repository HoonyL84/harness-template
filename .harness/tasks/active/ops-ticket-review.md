# TICKET: ops-ticket-review

## Type
feat

## Goal
- 사용자가 Jira 티켓의 중요도와 계획을 승인하면 공통 최대 3회 시도 정책으로 실행한다

## Scope
- 요청 계획의 priority와 retry_policy, 설정 수정 및 승인 결속, 실행 순서와 사용자 결과 검수

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [x] Jira 읽기 어댑터와 출처 지문 구현/fixture 검증. 카드 상태만으로 실행을 승인하지 않는다. 실제 계정 검증은 별도다.
- [x] priority와 계획을 포함한 티켓 초안을 출력하고 최대 시도 3회는 공통 정책으로 안내한다.
- [x] 설정 수정은 DRAFT에서만 허용하고 승인 fingerprint에 결속한다. 승인 이후 수정은 새 초안과 재승인을 요구한다.
- [x] 의존성이 준비된 티켓 사이에서 중요도를 적용하고, API runner 누적 시도 한도를 보존한다.
- [x] REVIEW_READY는 사용자 검수 대기이며, Git 반영은 기존 별도 승인 절차를 유지한다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED (2026-09-18 user requested start/continue; no Git approval)
- Priority suggestion: P1
- Shared max attempts: 3 (initial attempt 1 + retries 2; no per-ticket input)
- Effective priority: not assigned
- Shared runner max attempts: 3 (implemented for new request plans)
- Result review: required from user

## Dependencies
- none

## Plan Reference
- docs/project/OPERATIONS_COMPLETENESS_PLAN.md
- docs/project/CONFLUENCE_PERSONAL_OPERATIONS.md
- 구현 결과 검수 대기다. 중요도 P1은 제안값이며 사용자가 직접 지정한 값으로 표현하지 않는다.

## Risk
- 중간

## Notes
- Created from harness CLI.

## Implementation and Verification
- Request priority + shared retry default, immutable execution binding, Jira read-only import/freshness gates.
- Retry charge persisted before provider calls; interrupted attempts fail closed; attempt history preserved.
- Terminal outcome delivery stored with execution state; runner notify retries notification only.
- Added HARNESS_PERSONAL_OPERATIONS_GUIDE.md with implemented vs planned boundaries.
- Full offline verification passed: coverage thresholds and lint/build. Full regression suite: 152 passed.
- No actual Jira/Confluence credentials used, no live account validation, no commit/push.
- Follow-on implementation now includes Jira creation/Confluence outbox, history/search/context and OpenAI/Anthropic account usage. Remaining gaps: docs/project/PERSONAL_OPERATIONS_VALIDATION.md.
- Interactive host-wide retry enforcement is not provided by the API runner; this limitation is documented.
