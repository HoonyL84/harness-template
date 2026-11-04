# TICKET: planning-quality-api

## Type
feat

## Goal
- 선택형 API 계획 초안 생성

## Scope
- T03: request generate, 기존 3사 공급자/라우터/관측 사용량 재사용.
- 기본 dry-run, live는 전송 승인·입력 지문·API 모드·1회 한도 필요.
- STARTED/RECEIVED/FAILED 기록, 자동 HTTP 재시도 없음, 공통 draft validator 사용.

## Out of Scope
- 유료 호출, 외부 게시, 원본 프로젝트 수정, 커밋·푸시

## Acceptance Criteria
- [x] 세 공급자 mock, 무승인 호출 0회, high/fast 충돌, quota/timeout/불완전 응답 차단.
- [x] API 응답도 공통 출처/승인 계약으로만 저장.

## Risk
- 보통

## Notes
- 선행: planning-quality-approval. T04와 논리적 병렬 가능하나 동일 브랜치에서 순차 통합.
- 실제 유료 호출·비용/성능 실측은 미실행. 구현 검증과 모델 품질 평가를 구분한다.
- 통합 Full 근거: observability/metrics/planning-quality-rehearsal.verify.json.
- 구현·모의 검수 완료, 커밋/릴리스 승인 전이므로 archive하지 않음.
