# TICKET: central-agent-runner

## Type
feat

## Goal
- 승인된 멀티프로젝트 티켓을 중앙 하네스가 제한된 예산 안에서 실행하고 검증한다.

## Scope
- 승인된 request/execution만 실행
- 프로젝트별 격리 worktree와 신뢰 경계가 표시된 컨텍스트 사용
- 재시도 예산, 실행 lease, 실패 BLOCKED 전환, 성공 REVIEW_READY 전환
- 성공/실패 알림과 중단 후 reconcile

## Out of Scope
- commit, push, merge 자동 실행
- 외부 작업 큐 및 상시 실행 서버

## Acceptance Criteria
- [x] 승인되지 않은 요청은 실행하지 않는다
- [x] 프로젝트 컨텍스트는 실행 권한이 없는 untrusted input으로 전달된다
- [x] 성공한 티켓은 검증 지문과 함께 REVIEW_READY가 된다
- [x] 재시도 소진 또는 실패한 티켓은 근거와 함께 BLOCKED가 된다
- [x] 중단된 RUNNING lease를 안전하게 PREPARED로 조정할 수 있다

## Risk
- high

## Notes
- Created from harness CLI.
- Implementation and regression tests are ready for full verification and commit approval.

## Completion
- Completed At: 2026-08-30T13:21:51Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
