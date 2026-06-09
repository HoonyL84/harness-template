# TICKET: cli-smoke-tests

## Type
chore

## Goal
- Node Harness CLI가 Windows/macOS/Linux에서 같은 핵심 워크플로우 결과를 내는지 검증하는 smoke test를 추가한다

## Scope
- `check`, `create-ticket`, `start-ticket`, `verify`, `complete-task`의 최소 성공 경로를 CI에서 검증한다
- Bash/PowerShell wrapper가 공통 CLI를 호출하는지만 정적으로 확인한다

## Out of Scope
- 실제 provider API 호출 테스트
- 모든 OS 조합의 장시간 end-to-end 테스트

## Acceptance Criteria
- [ ] CI에서 Node Harness CLI smoke test가 통과한다
- [ ] wrapper와 공통 CLI 동작 차이를 감지할 수 있다

## Risk
- 낮음

## Notes
- Created after consolidating core workflow logic into `tools/harness-cli/index.js`.
