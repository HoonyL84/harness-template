# TICKET: planning-ticket-artifacts

## Type
feat

## Goal
- 기획·기술설계·개발 티켓 구분과 산출물 검수 경계 구현

## Scope
- 중앙 티켓·실행·기록·Jira 표시·테스트·가이드

## Out of Scope
- 실계정 변경·프로젝트별 권한 모드·커밋·푸시

## Acceptance Criteria
- [x] 개발 호환·산출물 검수·코드 변경 차단·승인 결속·모의 E2E·Full 검증

## Risk
- 낮음

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. 중앙 티켓 종류와 산출물 승인 결속 → 검증: legacy 호환·변조 차단 테스트
2. 기획/설계 검토 준비와 API 역할 라우팅 → 검증: 실제 임시 Git worktree와 모의 API
3. Jira 라벨·이력 검색·Confluence 결과 근거 → 검증: mock payload와 스냅샷 검증
4. 문서·전체 회귀·Full 검증·자가 검토 → 검증: verify --full --offline --task planning-ticket-artifacts

## Release Boundary
- 사용자 Git 반영 승인 전 커밋·푸시·병합하지 않는다.
- 기존 active 티켓은 변경하지 않는다.

## Validation Evidence
- npm test: 252 passed, 0 failed, 0 skipped.
- verify --full --offline --task planning-ticket-artifacts: coverage and lint passed.
- Real temporary Git/worktree fixtures; model replies, notifications and human acceptance are mocked. No remote Jira/Confluence writes or paid API calls.
- Final approval for commit/push is pending; this ticket remains active until the release workflow is completed.
