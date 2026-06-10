# TICKET: bind-verify-to-content

## Type
fix

## Goal
- 완료 시 현재 콘텐츠가 마지막 verify 통과 상태와 같은지 확인한다

## Scope
- 저장소 콘텐츠 지문 기록과 complete-task/L5 완료 게이트

## Out of Scope
- 원격 CI 상태 검증

## Acceptance Criteria
- [x] verify 이후 콘텐츠 변경 시 완료를 거부한다.
- [x] 동일 콘텐츠를 구현 커밋한 뒤에는 완료를 허용한다.
- [x] L5 archive에도 같은 완료 무결성 게이트를 적용한다.

## Risk
- medium

## Notes
- Created from harness CLI.
- verify 메트릭에 저장소 콘텐츠 지문을 기록하고 일반/L5 완료 경로에서 비교한다.

## Completion
- Completed At: 2026-06-10T11:26:46Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
