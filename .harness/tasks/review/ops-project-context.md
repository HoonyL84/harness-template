# TICKET: ops-project-context

## Type
feat

## Goal
- 새 대화와 도구에서도 프로젝트별 배경과 이전 작업을 읽고 재개한다

## Scope
- 최근 결정과 결과의 컨텍스트 연결, 최신성 검사, 공통 시작 절차와 완료 후 갱신

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [ ] Confluence 프로젝트 배경/결정을 page ID/version과 함께 제한된 번들로 읽는다. 원격 문서와 로컬 코드가 다르면 차이를 표시하며 문서가 실행 권한을 바꾸지 못한다.
- [ ] 새 프로세스에서도 이전 결정/작업 결과/실패/다음 행동을 읽는다.
- [ ] 등록 당시 Git 상태를 현재 상태로 오인하지 않고 문서 변경과 미기록 차이를 감지한다.
- [ ] 기록을 갱신할 때 프로젝트 간 섞임을 방지하고 변경 없음도 명시적으로 기록한다.
- [ ] 번들 크기 제한과 untrusted-project-input 정책을 유지하고 도구별 진입 가이드가 공통 절차를 가리킨다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED; priority and final result review remain with user
- Priority suggestion: P1
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
- Implemented connect/check/discover/map with local atomic configuration, explicit remap, scoped token gateway, project/type/space/page validation, and concurrent-config-change rejection. Connection tests use mocked HTTP; no personal account connected yet.
- Follow-up authorized: local Atlassian connect/discover/map/check commands. Validate project/space/page mappings using read-only requests before atomic configuration changes; retain existing mappings and publishing approval. Contract tests and full offline verification required.
- Added bounded project-specific history and versioned allowlisted Confluence page snapshots to context bundles.
- Current Git diagnosis is separate from registration data; local context hashes are compared with the approved profile.
- Remote data stays untrusted and cached; changed connection/page allowlists reject stale snapshots.
- No automatic semantic code/document consistency guarantee. Real remote freshness requires explicit context refresh.

## Operational Review
- [ ] 필요한 시점의 원격 refresh와 실제 운영 검수

구현 병합과 운영 수락은 다르다. 원문과 과거 근거는 보존하며 현재 완료·사용자 승인으로 재해석하지 않는다.
