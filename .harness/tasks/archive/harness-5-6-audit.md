# TICKET: harness-5-6-audit

## Type
chore

## Goal
- 하네스 v1.0.0의 CLI, 검증, CI, 문서 계약을 재검수하고 발견된 저위험 결함을 수정한다

## Scope
- CLI, 테스트, 커버리지, L5 소크, Git worktree E2E 기준선을 검증한다.
- 안전 정책과 사용자 문서의 실행 명령이 일치하는지 확인한다.
- 검수에서 발견한 저위험 문서 및 진단 결함과 의존성 취약점을 수정한다.

## Out of Scope
- 실제 provider API를 사용하는 장시간 L5 품질 검증
- 메인 CLI의 대규모 모듈 분리와 전체 커버리지 재설계
- 멀티에이전트 native host별 통합 구현

## Acceptance Criteria
- [x] `npm test`, `npm run coverage`, `npm run lint`, `npm run test:soak`가 통과한다.
- [x] 실제 Git worktree E2E 테스트가 skip 없이 통과한다.
- [x] main/master 보호와 Full verify 완료 계약이 모든 주요 진입 문서에서 일치한다.
- [x] npm audit에서 알려진 취약점이 없다.
- [x] `npm run harness -- verify --full`이 통과한다.

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-07-10T05:12:50Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
