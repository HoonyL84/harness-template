# TICKET: ops-provider-account-usage

## Type
feat

## Goal
- 공급자의 공식 조회 API로 계정 사용량과 비용을 조회하고 예산과 실제 잔액을 구분한다

## Scope
- 기존 provider-usage 확장, 관리자 인증, 부분 실패와 캐시, 실계정 검증 여부 표시

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [ ] 일반 모델 키와 조회용 관리자 인증을 분리하고 키를 로그나 결과에 노출하지 않는다.
- [ ] 공식 사용량/비용 응답을 기간/단위/페이지네이션에 맞게 처리한다.
- [ ] 설정 예산 잔여액과 실제 잔액을 구분하고 미지원/권한 부족/조회 실패를 0으로 표시하지 않는다.
- [ ] 계약 테스트와 실제 계정 검증을 구분하며 조회 실패가 다른 공급자 결과를 버리지 않는다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED; priority and final result review remain with user
- Priority suggestion: P2
- Shared max attempts: 3 (initial attempt 1 + retries 2; no per-ticket input)
- Effective priority: not assigned
- Planned max attempts: 3 (implemented in API runner)
- Result review: required from user

## Dependencies
- ops-ticket-review

## Plan Reference
- docs/project/OPERATIONS_COMPLETENESS_PLAN.md
- docs/project/CONFLUENCE_PERSONAL_OPERATIONS.md
- 사용자가 구현 진행을 승인했다. 중요도 제안값은 사용자 확정 전 실행 설정으로 사용하지 않는다.

## Risk
- 중간

## Notes
- Created from harness CLI.

## Implementation Progress
- Follow-up authorized: add three-provider read-only connection diagnostics and Gemini Cloud Monitoring request usage. Test credentials, pagination, cache and no-data/error semantics; then full offline verification. Live account validation remains separate.
- Added OpenAI/Anthropic organization usage and cost GET adapters with admin-only credentials, pagination caps and five-minute credential/period-bound caching.
- Reports separate usage/cost failure and unknown actual balance; Gemini now reports Cloud Monitoring request counts, not tokens or balance.
- Contract tests cover pagination loops, partial 403, cache/key change, malformed data and Anthropic cents conversion.
- Added three-provider model catalog checks and the Gemini read-only Cloud Monitoring adapter with daily sums, bounded paging and credential-bound caching. Missing data/permissions never become zero balance.
- No actual account credentials used. Gemini billing export/OAuth auto-refresh and live account validation remain.
