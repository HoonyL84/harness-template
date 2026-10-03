# TICKET: ops-ticket-search

## Type
feat

## Goal
- 프로젝트별 티켓과 완료 이력을 복합 조건으로 검색하고 원본 근거를 조회한다

## Scope
- legacy 및 중앙 티켓 통합 조회, 프로젝트/중요도/상태/기간/기술/검색어 필터, 가져오기 미리보기

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [ ] Jira 티켓 검색과 Confluence 문서 검색을 구분하고 상세 필드 필터, 양쪽 원본 링크와 로컬 미동기화 상태를 제공한다. 조회 실패를 빈 결과로 숨기지 않는다.
- [ ] legacy와 중앙 티켓을 프로젝트/상태/중요도/기간/기술/검색어로 검색한다.
- [ ] 서로 다른 프로젝트 또는 요청의 같은 티켓 이름을 구별하고 각 결과의 원본 경로를 제공한다.
- [ ] 기간 경계, 한글 검색, 빈 결과와 손상된 기록에 대한 테스트를 통과한다.
- [ ] 과거 기록 가져오기는 미리보기를 제공하고 재실행해도 중복 등록하지 않는다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED; priority and final result review remain with user
- Priority suggestion: P2
- Shared max attempts: 3 (initial attempt 1 + retries 2; no per-ticket input)
- Effective priority: not assigned
- Planned max attempts: 3 (implemented in API runner)
- Result review: required from user

## Dependencies
- ops-work-history

## Plan Reference
- docs/project/OPERATIONS_COMPLETENESS_PLAN.md
- docs/project/CONFLUENCE_PERSONAL_OPERATIONS.md
- 사용자가 구현 진행을 승인했다. 중요도 제안값은 사용자 확정 전 실행 설정으로 사용하지 않는다.

## Risk
- 중간

## Notes
- Created from harness CLI.

## Implementation Progress
- history list/search/export/refresh provides central and legacy records with compound local filters and explicit source/sync status.
- Added separate Jira and Confluence remote searches, bounded pagination and partial/error statuses.
- Tests cover Korean query, UTC range validation, legacy unknown evidence, project isolation and remote cursor errors.
- Added remote Jira status/priority and Jira/Confluence date filters with project boundaries preserved; see docs/project/PERSONAL_OPERATIONS_VALIDATION.md for live validation gaps.

## Operational Review
- [ ] 실제 업무 기록 누락 점검과 검색 결과 검수

구현 병합과 운영 수락은 다르다. 원문과 과거 근거는 보존하며 현재 완료·사용자 승인으로 재해석하지 않는다.
