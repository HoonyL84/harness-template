# TICKET: harden-blocked-notifications

## Type
fix

## Goal
- 검증 실패 종료, blocked 전환, 알림 설정과 운영 문서를 안전하게 보완한다

## Scope
- verify 실패 제어 흐름, 설정 스키마, Telegram 알림, AGENTS 문서, 회귀 테스트

## Out of Scope
- 기존 멀티 에이전트 및 L5 정책 변경

## Acceptance Criteria
- [x] 일반 실패가 즉시 종료되고 auto-fix 소진 시 blocked 이동하며 전체 테스트와 Full 검증을 통과한다

## Risk
- 중간

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:26:44Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
