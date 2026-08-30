# TICKET: ticket-retry-policy

## Type
feat

## Goal
- 티켓별 재시도 기본값을 계획에 결속하고 사용자가 승인 전 수정하며 실행 시 임의 상향을 차단한다

## Scope
- [x] 티켓마다 승인 가능한 `retry_policy`를 저장한다.
- [x] 정책이 없으면 안전한 기본값을 적용한다.
- [x] DRAFT 계획은 `request revise --plan-file`로 수정할 수 있다.
- [x] Runner는 티켓 생애 누적 시도 횟수와 CLI 상한 중 더 작은 값을 적용한다.
- [x] 동일 오류 반복 시 남은 횟수가 있어도 조기 중단한다.

## Out of Scope
- 실패한 BLOCKED 티켓의 무승인 재개
- 모델별 실제 토큰 수 과금 집계
- 승인된 계획의 실행 중 정책 변경

## Acceptance Criteria
- [x] 기본 정책은 최대 2회, 동일 오류 조기 중단이다.
- [x] plan-file의 티켓별 1~5회 설정이 fingerprint에 포함된다.
- [x] 잘못된 정책 타입과 범위는 계획 생성 시 차단된다.
- [x] CLI 옵션으로 승인된 티켓 상한을 늘릴 수 없다.
- [x] 누적 상한과 동일 오류 중단을 단위 테스트로 검증한다.
- [x] lint, coverage, build와 Harness Full 검증이 통과한다.

## Risk
- 낮음

## Notes
- Created from harness CLI.
