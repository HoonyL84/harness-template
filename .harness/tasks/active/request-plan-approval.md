# TICKET: request-plan-approval

## Type
feat

## Goal
- 자연어 요청을 프로젝트별 티켓과 실행 계획으로 분해하고 사용자 계획 승인을 강제한다

## Scope
- 요청 이해, 가정, 제외 범위, 티켓, 의존성, 검증·알림 계획, 승인 상태

## Out of Scope
- 코드 구현과 Git 커밋

## Acceptance Criteria
- [x] 승인된 프로젝트 프로필만 요청 계획에 사용할 수 있다
- [x] 단일·다중 프로젝트 티켓과 AI 생성 plan JSON을 지원한다
- [x] 계획에 가정·제외 범위·검증·알림 정책과 프로필 지문을 기록한다
- [x] 승인 전 실행 준비 판정을 차단한다
- [x] 계획 변조나 프로젝트 프로필 변경 시 실행 준비 판정을 차단한다

## Risk
- 중간

## Notes
- Created from harness CLI.
