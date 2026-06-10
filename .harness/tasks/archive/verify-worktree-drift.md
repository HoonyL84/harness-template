# TICKET: verify-worktree-drift

## Type
fix

## Goal
- verify 실행 중 생긴 작업 트리 변경을 감지한다

## Scope
- 검증 전후 Git 작업 트리 지문 비교

## Out of Scope
- 테스트 산출물 자동 삭제

## Acceptance Criteria
- [x] 검증 중 새 파일이나 내용 변경이 생기면 verify가 실패한다

## Risk
- low

## Notes
- Created from harness CLI.
- 토이 프로젝트에서 테스트가 생성한 `verify-side-effect-import.csv`를 감지해 verify를 실패 처리했다.
- PowerShell 스모크 테스트 전체 흐름을 통과했다.

## Completion
- Completed At: 2026-06-10T11:06:40Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
