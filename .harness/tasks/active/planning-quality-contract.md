# TICKET: planning-quality-contract

## Type
feat

## Goal
- 입력·출력·출처 스냅샷 계약

## Scope
- T01: 원문·프로젝트 프로필·명시 자료·공통 프롬프트 스냅샷.
- planning-contract.js: 구간/해시, 기존·신규 경로, 사실·제안·질문·관계 계약.
- Markdown 참조 정책 유지, 코드 구간의 명시 선택, 크기·비밀 패턴·junction 검사.

## Out of Scope
- 유료 호출, 외부 게시, 원본 프로젝트 수정, 커밋·푸시

## Acceptance Criteria
- [x] 계약 성공/실패, 가짜 인용, 경로 탈출, 예약 파일명, 과대 입력, 위험 명령 거부.
- [x] Git 선행 관계 공개와 DAG 검사, 문서 참조 관계 분리.

## Risk
- 보통

## Notes
- 선행 없음. T02/T04가 이 계약을 사용한다.
- 테스트: tests/harness-cli/planning-quality.test.js.
- 통합 Full 근거: observability/metrics/planning-quality-rehearsal.verify.json.
- 구현·로컬 검수 완료, 커밋/릴리스 승인 전이므로 archive하지 않음.
