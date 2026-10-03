# TICKET: operations-visibility

## Type
feat

## Goal
- 티켓 검수 대기 정합성·로컬 대시보드·안전 복구 안내·선택형 관측 비용

## Scope
- 티켓 기록, CLI 현황/안내, 관측 비용, 회귀 테스트와 문서

## Out of Scope
- 자동 티켓 수락, 원격 게시, 강제 정리, 계정 잔액 추정, 커밋·푸시

## Acceptance Criteria
- [x] 검수 대기 분리, 기본 로컬 조회, 확실한 실패/불확실한 게시 구분, 출처 기반 비용과 unknown 회귀 및 Full 검증

## Risk
- 낮음

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. 과거 티켓 원문과 운영 잔여 조건을 review 상태에 보존 → 검증: 감사·검색·active 재개 회귀
2. 로컬 대시보드 확장, 진단/알림 명시 opt-in → 검증: 네트워크/쓰기가 기본 0, unknown과 키 비노출
3. outbox 상태별 복구 안내 → 검증: 불확실한 쓰기 재POST/승인/삭제 없음
4. 출처·기준일 기반 선택형 비용 → 검증: 캐시 분리·불완전/과거 기록 unknown·잘못된 설정 거부
5. 전체 테스트와 Full 검증; 실제 외부 호출과 Git 반영은 하지 않음

## Implementation Evidence
- 2026-10-03: 집중 테스트 13개, 전체 테스트 293개 통과(pass 293, fail 0, skipped 0). Full 오프라인 coverage/lint 검증 통과.
- 과거 티켓 8개의 원문을 HEAD와 대조하여 review 이동 후 보존을 확인했다. 운영 수락으로 마감하지 않았다.
- 실제 로컬 dashboard JSON 조회: active 1, review 8. 등록된 3개 프로젝트의 dirty/clean 상태와 연결 not-checked/not-configured를 구분했다. 다른 프로젝트를 수정하지 않았다.
- 실제 로컬 outbox recovery 조회: 4건, 자동 조치 0. 실계정 진단/게시/알림이나 유료 API 요청은 하지 않았다.
- 비용 테스트 단가는 합성값이다. 실제 비용 추정은 사용자 관리 로컬 단가표가 필요하며 계정 잔액·청구액을 보장하지 않는다.
- Runtime smoke는 설정되지 않아 Full 통과만으로 실서비스 동작을 증명하지 않는다. 외부 진단 분기는 모의 응답으로 검증했다.
- Git 반영 승인 대기: 이 작업은 커밋·푸시·main 병합하지 않았다.

## Completion
- Completed At: 2026-10-03T06:20:40Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none

## Git Publication Approval
- 사용자가 구현·완료 기록 커밋, 작업 브랜치 푸시, 필수 CI 통과 후 main 병합과 로컬 main 갱신을 명시 승인했다.
- 구현 커밋: 28ebe34. 구현 커밋/푸시 이후 Full 검증을 새로 통과한 지문으로 complete-task를 수행했다.
- 과거 8개 review 티켓의 운영 수락은 이 승인에 포함되지 않으며 미완료로 보존한다.
