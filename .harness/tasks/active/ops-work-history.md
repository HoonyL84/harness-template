# TICKET: ops-work-history

## Type
feat

## Goal
- 작업과 검증 결과를 프로젝트별로 보존하고 필수 기록 없는 완료를 차단한다

## Scope
- 단일 및 중앙 작업 기록, 저장 실패와 중단 복구, 중복 방지, 결과 검토와 릴리스의 분리

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [ ] 중간 실패는 기록만 하고 검증 성공(REVIEW_READY), 3회 소진 또는 즉시 중단(BLOCKED) 시 Telegram 알림을 보낸다. 알림 전송 재시도는 개발 시도 횟수와 분리한다.
- [ ] Confluence 페이지 API 연동과 로컬 outbox를 구현한다. 버전 충돌, 응답 유실, 제한 재시도, 페이지네이션 및 중복 게시 방지를 fixture로 검증한다.
- [ ] 로컬 결과 저장 실패와 원격 게시 실패를 구분한다. 성공/실패/검수 필요 알림에는 프로젝트, 티켓, 기록 링크 또는 동기화 대기 상태를 표시한다.
- [ ] 시작/실패/재시도/검증/사용자 검수/릴리스 이력을 프로젝트와 티켓 ID로 연결한다.
- [ ] 저장 실패 시 완료 처리하지 않고 상태 저장과 이력 쓰기 사이 중단 후 재실행해도 중복 기록하지 않는다.
- [ ] 단일 프로젝트 완료 시 원본 검증 기록이 정리되기 전에 근거와 실제 결과를 보존한다.
- [ ] 이력이 없는 외부 Git 작업은 미기록으로 표시하고 과거 사용자 승인이나 검증 성공을 꾸며내지 않는다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED; priority and final result review remain with user
- Priority suggestion: P1
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
- Added durable history intents/snapshots and pre-cleanup completion verification evidence.
- Added explicit preview/digest-approved Jira creation and append-only Confluence publication outbox.
- Unknown POST outcome requires marker reconciliation; definite HTTP rejection requires explicit requeue and a new approval digest.
- Passed unit/fixture tests for duplicate prevention, changed destination, loss of response, history persistence failure and stale review fingerprint.
- Added explicit approved Jira transition writes with source status/updated checks; no automatic polling or card-driven code execution.
- Deliberate boundary: no existing Confluence page overwrite.
- Remaining acceptance gaps are tracked in docs/project/PERSONAL_OPERATIONS_VALIDATION.md. Not archived or Git-approved.
