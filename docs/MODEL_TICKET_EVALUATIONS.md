# 고정 티켓 사례의 공급자·모델 평가

## 목적과 경계

동일한 입력·채점 정책에서 OpenAI, Anthropic, Gemini의 티켓 기획 응답을 비교합니다. 모델이나 가격 기본값을 고정하지 않습니다. 모델은 명시적으로 선택하고, 기존 공급자 키는 로컬 `.env.local`에만 둡니다.

현재 사례는 관찰했던 문제를 익명화한 합성 사례 3개입니다.

- 독립 프로젝트의 티켓 분해와 의존성 구조
- 필수 컨텍스트가 없을 때 BLOCKED 처리
- 신뢰하지 않는 프로젝트 문서의 승인 우회 지시 거부

자동 채점은 JSON 구조, 필수 항목, 허용 검증 명령, 의존성 그래프, 승인 필드만 확인합니다. 의미적으로 충분한 계획인지, 실제 코드가 올바른지는 보장하지 않습니다. 생성된 코드·명령은 실행하지 않고 프로젝트나 Jira/Confluence도 변경하지 않습니다. 이것은 그래프 DB나 새로운 에이전트 실행기가 아닙니다.

## 기본 사용: 호출 없는 미리보기

```bash
npm run harness -- eval list
npm run harness -- eval run --provider openai --model YOUR_MODEL
```

기본값은 dry-run입니다. API 호출은 0회이며 결과 파일도 만들지 않습니다. 실제 모델명으로 `YOUR_MODEL`을 교체하세요. `--cases missing-context`처럼 사례를 제한할 수 있습니다.

## 실제 평가: 비용이 발생할 수 있음

사용자가 모델과 호출 예산을 확인한 다음 실행합니다. `.env.local`의 `HARNESS_AGENT_MODE=api`와 선택한 공급자의 유효한 키가 필요합니다. 대화형 호스트의 구독/로그인과는 별개입니다.

```bash
npm run harness -- eval run --provider openai --model YOUR_MODEL --live --max-requests 3 --max-attempts 1
npm run harness -- eval run --provider anthropic --model YOUR_MODEL --live --max-requests 3 --max-attempts 1
npm run harness -- eval run --provider gemini --model YOUR_MODEL --live --max-requests 3 --max-attempts 1
```

- 공급자, 모델, `--live`, `--max-requests`를 명시해야 합니다. 활성 공급자 설정을 바꾸지 않습니다.
- 전체 호출 한도는 1~9회, 사례당 시도는 1~3회입니다. 평가 기본 시도는 1회이며 일반 티켓 기본 정책과 별개입니다.
- 자동 채점 실패에만 한도 내 재시도할 수 있습니다. `missing_context` 같은 필드의 잘못된 타입은 채점 실패이지 API 장애가 아닙니다. API 오류·인증·요금·시간 초과는 전체 평가를 중단합니다. 응답 수신 후 로컬 처리 오류는 `EVALUATION_ERROR`로 별도 기록하고 중단합니다. 숨겨진 HTTP 재시도는 없습니다.
- 요청당 타임아웃은 60초, 출력 토큰 요청 한도는 4096입니다. 공급자마다 토큰·추론 토큰 정의가 달라 동등한 작업량/가격 상한을 의미하지 않습니다.
- 기존 `HARNESS_MAX_PROVIDER_REQUESTS` 등의 더 낮은 요청 제한도 적용됩니다.
- 호출 예산 소진, 누락 사례, API 오류는 INCOMPLETE입니다. 자동 채점 실패 및 INCOMPLETE는 종료 코드 1입니다.
- 호출 전에 STARTED 근거를 저장합니다. 강제 종료 후 RUNNING 기록은 비교/검수 대상으로 인정하지 않습니다. 자동 재개로 추가 과금하지 않습니다.

## 조회, 비교, 사람 검수

결과는 Git에서 제외되는 `.harness/local/evals/eval-<UUID>.json`에 원자적으로 저장합니다. 출력된 실제 실행 ID를 사용하세요.

```bash
npm run harness -- eval show eval-FIRST_UUID
npm run harness -- eval compare eval-FIRST_UUID eval-SECOND_UUID
npm run harness -- eval review eval-FIRST_UUID --fingerprint RESULT_SHA256 --result accepted --reason "각 티켓의 범위와 테스트 계획을 확인함" --minutes 5
```

`review`는 `accepted` 또는 `changes-requested`를 기록하며 현재 결과 지문이 필요합니다. 재검수는 `review_history`에 순서대로 누적하고 `review`에는 최신 결과를 유지합니다. 기존 단일 검수 기록은 다음 검수 시 첫 이력으로 보존합니다. 검수 이력은 자체 체크섬으로 변경 여부를 검사하며, 검수를 추가해도 원래 평가 결과 지문은 바뀌지 않습니다. 이 기록은 계획 승인이나 Git 반영 승인이 아닙니다. 로컬 지문은 실수로 바뀐 근거를 탐지하는 장치이지 OS 보안 샌드박스나 변조 불가능한 서명이 아닙니다.

동일 사례·시스템 프롬프트·채점/엔진/전송 코드·시도/호출 예산·출력 제한의 완료 평가끼리만 비교합니다. 다른 모델 선택은 허용합니다. 응답에 실제 모델명이 없으면 null로 기록합니다. API 별칭의 버전 변경·확률적 편차가 있으므로 여러 차례의 실제 평가와 사람 검수를 병행해야 합니다. 자동으로 우승 모델을 선택하거나 모의 응답으로 성능 순위를 만들지 않습니다.

## 측정하는 것과 모르는 것

- 자동 채점 통과 수 / 전체 사례 수
- 시도와 재시도 횟수, 각 요청의 관측 응답 시간
- API가 반환한 입력·출력·합계 토큰 및 실제 응답 모델명
- Anthropic·Gemini의 응답은 추론/도구 블록을 제외한 텍스트 조각 전체를 순서대로 연결합니다. 서로 다른 후보 응답은 섞지 않습니다.
- 선택적인 사람 검수 결과와 소요 시간

사용량 정보가 없거나 실패 요청의 과금량을 모르면 합계는 null입니다. 응답 시간은 전체 개발 시간이 아니며 토큰 수는 계정 잔액이 아닙니다. 가격표·청구 내역을 조회하지 않으므로 `cost_usd`는 null입니다. 3개의 구조/안전 사례 통과만으로 코드 개발 능력이나 실무 정확도를 주장하면 안 됩니다.

참고: [평가 설계 원칙](https://developers.openai.com/api/docs/guides/evaluation-best-practices), [토큰 계산과 출력 제한](https://developers.openai.com/api/docs/guides/token-counting).

## 검증

```bash
node --test tests/harness-cli/model-eval-command.test.js
npm test
npm run harness -- verify --full --offline --task model-ticket-evaluations
```

자동 테스트는 주입된 모의 전송으로 비용·중단·재시도·채점·비교·검수 경계를 검증합니다. 실제 모델 품질과 계정 접속 성공을 증명하지 않습니다.
