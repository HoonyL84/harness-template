# TICKET: project-scoped-execution

## Type
feat

## Goal
- 승인된 티켓을 프로젝트별 격리 상태와 worktree에서 실행한다

## Scope
- project_id:ticket_id 상태, 잠금, worktree, 검증, 실패 보존

## Out of Scope
- 최종 커밋과 경력 자료 출력

## Acceptance Criteria
- [x] 승인된 요청과 승인 프로젝트 프로필만 실행 준비할 수 있다
- [x] 실행 직전 HEAD와 원본 작업 트리 지문 드리프트를 차단한다
- [x] 프로젝트·티켓별 독립 branch와 worktree 경로를 사용한다
- [x] 티켓별 준비 실패를 BLOCKED로 보존하고 다른 작업 파일을 삭제하지 않는다
- [x] 실행 상태는 Git 제외 로컬 파일에 원자적으로 저장한다

## Risk
- 중간

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:25:57Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
