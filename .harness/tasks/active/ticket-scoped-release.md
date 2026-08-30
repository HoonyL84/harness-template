# TICKET: ticket-scoped-release

## Type
feat

## Goal
- 요청 전체가 아닌 REVIEW_READY 티켓 하나를 지문 결속 승인으로 커밋·푸시·병합한다

## Scope
- [x] `release request --ticket <id>`로 REVIEW_READY 티켓만 선택한다.
- [x] 선택 티켓 집합과 Git 작업 인자를 승인 지문에 결속한다.
- [x] commit/push/merge 결과를 해당 티켓 실행 상태에만 기록한다.
- [x] 기존 전체 요청 릴리스 동작은 호환 유지한다.

## Out of Scope
- 승인 없는 Git 작업
- 여러 프로젝트를 하나의 원자적 Git 트랜잭션으로 처리

## Acceptance Criteria
- [x] 다른 티켓이 대기 중이어도 선택 티켓이 REVIEW_READY면 릴리스 요청이 가능하다.
- [x] REVIEW_READY가 아닌 티켓 선택은 차단된다.
- [x] 승인 뒤 선택 티켓 또는 worktree가 바뀌면 적용이 거부된다.
- [x] 선택하지 않은 티켓 상태와 release history는 변경되지 않는다.
- [x] 기존 전체 릴리스 회귀 테스트가 통과한다.

## Risk
- 중간: 부분 릴리스 상태와 요청 전체 상태의 의미가 분리된다.

## Notes
- Created from harness CLI.
