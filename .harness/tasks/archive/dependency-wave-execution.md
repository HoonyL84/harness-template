# TICKET: dependency-wave-execution

## Type
feat

## Goal
- 선행 티켓의 승인된 커밋을 기준으로 후속 의존 티켓 worktree를 순차 준비한다

## Scope
- [x] 의존성이 없는 티켓만 최초 Wave에서 PREPARED로 전환한다.
- [x] 대기 티켓은 WAITING_DEPENDENCY 상태와 사유를 보존한다.
- [x] `execution advance`가 선행 티켓의 승인된 committed SHA를 확인한다.
- [x] 같은 프로젝트의 단일 선행 티켓 SHA에서 후속 worktree를 생성한다.
- [x] 다른 프로젝트 의존성은 완료 게이트로만 사용하고 대상 프로젝트의 승인된 HEAD를 기준으로 한다.
- [x] 같은 프로젝트 Fan-in은 자동 merge하지 않고 명시적으로 차단한다.

## Out of Scope
- 승인 없는 통합 commit
- 자동 conflict 해결
- 여러 선행 branch의 암묵적 merge

## Acceptance Criteria
- [x] 선행 티켓 커밋 전 후속 worktree가 생성되지 않는다.
- [x] 선행 committed SHA가 실제 commit이고 기대 branch에 포함되는지 확인한다.
- [x] 선행 commit 후 advance가 후속 worktree의 base_commit으로 해당 SHA를 기록한다.
- [x] 독립 티켓은 기존처럼 병렬 준비된다.
- [x] Fan-in은 BLOCKED가 아니라 승인 가능한 명시적 대기 사유로 보고된다.

## Risk
- 높음: 잘못된 base commit은 후속 티켓 코드 손실 또는 분기 오류를 만든다.

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T13:21:53Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
