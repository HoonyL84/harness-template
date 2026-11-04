# 모델 라우팅과 승인 계약

- 신규 계획은 Planner가 작업 범위를 보고 `risk: low|medium|high`와 `risk_reason`을 제안한다. 위험도는 모델이 검증한 안전 보증이 아니라 사람이 검토하고 승인할 계획 정보다.
- 한글 `낮음/보통/높음`은 표준 값으로 변환한다. null, 빈 문자열, 임의 문자열은 거부한다.
- 기존 위험도 없는 계획은 원본 JSON/승인 지문을 재작성하지 않는다. 실행 시 `low`, `risk_source: legacy-default`로 해석하고 API 실행 로그에 저위험 보증이 아닌 호환 기본값임을 경고한다. 명시된 위험도는 `risk_source: explicit`이다.
- 새 계획에는 위험도·출처·근거를 저장하고 계획 지문에 포함한다. 실행 상태와 승인 계획의 이 값들이 다르면 실행을 거부한다.
- 기존 DRAFT를 수정할 때 위험도를 새로 평가했다면 `risk_source`를 `explicit`으로 바꾸고 근거를 작성한다. 승인된 계획을 직접 고쳐 기존 승인을 재사용하지 않는다.
- 기획은 `type=docs/role=planner`, 설계는 `type=architect/role=architect`로 호출한다. 저위험 P2/P3 기획은 기본 fast, 고위험 및 설계는 기본 strong이다. P0/P1·넓은 범위·재시도 승격 규칙은 유지된다.
- `risk=high`와 명시적 `--model-tier fast`가 충돌하면 API 호출 전에 실패한다. 명시적 standard/strong은 허용한다. 모델 이름 자체의 성능/가격을 보증하지 않는다.

## 회귀 근거

`model-router.test.js`는 값 검증·승인 지문·레거시 무변경 호환을 검사한다.
`agent-runner.test.js`는 계획 생성/승인 → 실행 상태 → runner 전달 → CLI 공통 역할/타입 계약 → 최종 티어/모델 선택을 검사한다.
실제 공급자 요청은 사용하지 않으며 모델의 답변 품질을 검증한 결과는 아니다.
