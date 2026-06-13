# TICKET: harness-final-polish

## Type
chore

## Goal
- CLI 모듈 분리, ESLint 및 커버리지 게이트, v1.0.0 릴리스 준비

## Scope
- orchestration 상태·예산 로직을 독립 모듈로 분리한다.
- ESLint 정적 분석과 Node 테스트 커버리지 최소 임계값을 도입한다.
- 기존 CLI smoke test 티켓을 실제 구현 상태에 맞게 정리한다.
- v1.0.0 릴리스 노트와 변경 이력을 준비한다.

## Out of Scope
- CLI 전체 재작성
- 멀티에이전트 계약 변경
- provider API 동작 변경

## Acceptance Criteria
- [ ] orchestration 상태·예산 모듈 단위 테스트 통과
- [ ] ESLint 통과
- [ ] 커버리지 최소 임계값 통과
- [ ] 전체 하네스 검증과 크로스플랫폼 CI 통과
- [ ] v1.0.0 태그 및 GitHub Release 발행

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-06-13T23:10:41Z
- Verify Result: pass
- Rework Count: 1
- Last Failure: Node coverage: ERROR: Coverage for branches (69.45%) does not meet global threshold (70%)
