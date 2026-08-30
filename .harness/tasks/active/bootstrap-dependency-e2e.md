# TICKET: bootstrap-dependency-e2e

## Type
test

## Goal
- 신규·기존 프로젝트 자동 분기와 티켓 단위 릴리스·의존 Wave를 회귀 검증한다

## Scope
- [x] 신규 저장소와 기존 저장소 분기 테스트
- [x] bootstrap 승인 지문 변조·재사용·비밀 파일 차단 테스트
- [x] 부분 릴리스와 실행 상태 갱신 테스트
- [x] 선형 의존 Wave와 독립 병렬 티켓 테스트
- [x] Fan-in fail-closed 테스트
- [x] Windows/macOS/Linux 호환 문서 및 smoke 경로 갱신

## Out of Scope
- 실제 원격 저장소 push
- 운영 프로젝트 데이터 변경

## Acceptance Criteria
- [x] 신규 기능 단위 테스트와 임시 Git 저장소 E2E가 통과한다.
- [x] 기존 control-plane, runner, release 테스트가 회귀 없이 통과한다.
- [x] lint, coverage, build, Harness Full 검증이 통과한다.

## Risk
- 중간: Git 프로세스 테스트가 OS별로 다르게 동작할 수 있다.

## Notes
- Created from harness CLI.
