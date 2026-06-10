# TICKET: conditional-push-guidance

## Type
fix

## Goal
- 원격 저장소가 없는 프로젝트에는 push를 필수 단계처럼 안내하지 않는다

## Scope
- origin 존재 여부에 따라 commit 또는 commit and push 안내 선택
- start-ticket, complete-task, L5 안내 문구 일치
- PowerShell/Bash smoke test에서 원격 유무별 안내 회귀 검증

## Out of Scope
- 원격 저장소 자동 생성
- 자동 push 활성화

## Acceptance Criteria
- [x] origin이 있으면 commit and push를 안내한다
- [x] origin이 없으면 commit만 안내한다
- [x] 완료 기록 단계에도 같은 조건을 적용한다
- [x] 원본과 토이 프로젝트 스모크 테스트가 각각 통과한다

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-06-10T05:57:36Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
