# TICKET: test-ticket-type

## Type
fix

## Goal
- 테스트 전용 작업에 test 티켓 타입을 허용한다

## Scope
- 공통 CLI와 Bash/PowerShell wrapper에 test 타입 추가
- start-task, decompose, L5 planner 허용 목록 동기화
- smoke ticket을 test 타입으로 생성해 전체 흐름 검증

## Out of Scope
- 커밋 메시지 규칙 변경

## Acceptance Criteria
- [x] create-ticket이 test 타입을 허용한다
- [x] PowerShell과 Bash smoke flow가 test 티켓으로 통과한다
- [x] planner와 task decomposition이 test 타입을 거절하지 않는다

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-06-10T06:04:27Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
