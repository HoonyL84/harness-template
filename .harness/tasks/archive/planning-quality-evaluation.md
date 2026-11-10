# TICKET: planning-quality-evaluation

## Type
feat

## Goal
- 자료 기반 평가와 사용자 수정 기록

## Scope
- T04: 기존 eval 엔진에 planning 유형과 저장 응답 import 추가.
- 합성 입력 6개(개발 3/보류 3), 기대 조건·루브릭은 모델 입력에서 제외.
- planning-review의 누락/사실 주장/경계/수정 건수·시간·지문 및 초안 이력.

## Out of Scope
- 유료 호출, 외부 게시, 원본 프로젝트 수정, 커밋·푸시

## Acceptance Criteria
- [x] 기존 eval 회귀, 동일 조건 비교·다른 경로/루브릭 비교 거부.
- [x] 미관측 토큰·지연은 null. 인간 검수 식별자 덮어쓰기·과거 지문 재사용 거부.
- [x] 형식이 맞는 잘못된 해석은 자동 oracle로 검출하지 못함을 테스트로 명시.

## Risk
- 보통

## Notes
- 선행: planning-quality-contract. 입력·검수 연결은 T02/T03 계약 재사용.
- 실제 모델 비교·의미 품질 개선률은 미측정. mock 6개 통과는 품질 점수가 아니다.
- 통합 Full 근거: observability/metrics/planning-quality-rehearsal.verify.json.
- 구현·로컬 검수 완료, 커밋/릴리스 승인 전이므로 archive하지 않음.

## Completion
- Completed At: 2026-11-10T14:06:51Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
