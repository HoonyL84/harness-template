# TICKET: multi-project-e2e

## Type
test

## Goal
- 중앙 멀티 프로젝트 흐름을 실제에 가까운 두 개 이상의 샘플 저장소로 검증한다

## Scope
- 계획 승인, 격리 실행, BLOCKED, 성공, 커밋 승인, 경력 기록, 크로스 OS CI

## Out of Scope
- 실제 서비스 배포

## Acceptance Criteria
- [x] 공통 Node 테스트로 두 프로젝트의 상태 격리, 승인 전 차단, 승인 후 변경 차단, 승인 재사용 차단을 검증한다

## Risk
- 중간

## Notes
- Created from harness CLI.
