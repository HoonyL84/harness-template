# TICKET: multi-project-notifications

## Type
feat

## Goal
- 여러 프로젝트의 계획·실패·성공·커밋 승인 상태를 Telegram과 Slack으로 알린다

## Scope
- 이벤트 스키마, 템플릿, 중복 방지, 실패 선택지, 전체 상태 조회

## Out of Scope
- 모바일 대시보드 애플리케이션

## Acceptance Criteria
- [x] BLOCKED와 REVIEW_READY 알림이 근거와 다음 선택지를 포함하고 성공 전송된 같은 이벤트는 한 번만 전송된다

## Risk
- 중간

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:26:21Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
