# TICKET: control-plane-state-locking

## Type
fix

## Goal
- 멀티프로젝트 제어면의 JSON 상태 갱신에서 동시 실행에 의한 유실과 덮어쓰기를 방지한다.

## Scope
- request, execution, release, evidence, notification 상태
- 원자적 쓰기, 배타적 파일 잠금, stale lock 회수, 잠금 TTL
- 잠금 획득 후 최신 상태를 다시 읽는 read-modify-write 계약

## Out of Scope
- 외부 데이터베이스 및 분산 락 서비스

## Acceptance Criteria
- [x] 같은 상태 파일의 동시 갱신은 fail-closed로 직렬화된다
- [x] 만료되지 않은 잠금은 다른 writer가 탈취할 수 없다
- [x] 만료된 잠금은 안전하게 회수되며 임시 파일이 남지 않는다
- [x] 기존 상태 파일 스키마와 CLI 사용법이 유지된다

## Risk
- high

## Notes
- Created from harness CLI.
- Implementation and regression tests are ready for full verification and commit approval.
