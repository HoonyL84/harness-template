# TICKET: cli-entrypoint-coverage

## Type
test

## Goal
- 메인 CLI 명령 디스패치를 테스트 가능한 모듈로 분리하고 subprocess 실행 경로를 정량 커버리지에 포함한다

## Scope
- index.js의 명령 라우팅과 check/verify/complete 경로를 점진적으로 분리하고 실제 CLI 프로세스 커버리지를 수집한다

## Out of Scope
- 기능 동작 변경과 커버리지 임계값 하향

## Acceptance Criteria
- [ ] 메인 CLI 진입점이 coverage report에 포함되고 기존 임계값과 OS smoke test가 모두 통과한다

## Risk
- 중간

## Notes
- Created from harness CLI.
