# 계획 작성 품질 관리 가이드

## 바뀌는 것과 그대로인 것

사용자는 지금처럼 업무를 말한다. AI는 업무 분배·요약·관계·필수 질문을 먼저 보여주고,
상세 구현·테스트 계획은 기록한다. 아래 JSON과 CLI는 AI/운영자용이며 사용자가 직접 작성할 필요는 없다.

새 품질 경로는 `request capture -> draft -> approve -> ready`다.
계획 승인과 Git 릴리스 승인은 별개다. 계획 생성·검수는 개발 실행, Jira 게시, Git 반영을 실행하지 않는다.
기존 `request create/revise`, 승인된 레거시 계획, 기존 `eval`은 그대로 지원한다.

## 1. 입력 고정

전제: 프로젝트가 등록되고 온보딩 프로필이 승인되어 있어야 한다.
프로필의 검증 명령만 초안에 사용할 수 있다. 새 명령이 필요하면 프로필 변경을 먼저 검토한다.
AI가 사용자 요청 원문과 필요한 자료만 아래 manifest로 준비한다. 경로는 각 프로젝트 루트 기준이다.

```json
{
  "request": "로그인 재시도가 기존 동작을 깨지 않는지 테스트를 추가해줘.",
  "projects": ["demo"],
  "risk": "medium",
  "sources": [
    {"source_id": "rules", "project_id": "demo", "path": "docs/rules.md", "start_line": 1, "end_line": 3},
    {"source_id": "login", "project_id": "demo", "path": "src/login.js", "start_line": 10, "end_line": 30}
  ],
  "missing_context": []
}
```

```bash
node tools/harness-cli/index.js request capture login-tests --input-file .harness/local/planning-input.json
```

- 프로젝트 최대 10개, 명시 자료 최대 10개, 각 파일 및 입력 합계 96KB. 초과 시 실패하며 몰래 자르지 않는다.
- Markdown은 기존 `docs/**/*.md`, `AGENTS.md`, `README.md` 규칙을 유지한다.
- 코드/텍스트는 명시한 상대 경로만 읽는다. dot 경로, 비밀 파일명, 경로 탈출, symlink/junction을 거부한다.
- 원문, 선택 구간, 전체 파일 내용 해시, 프로필 지문을 저장한다. 구간 밖 내용 변경도 재검토 대상이다.
- 공통 프롬프트 본문도 입력에 보존한다. 프롬프트가 바뀌면 새 capture가 필요하다. API에는 system prompt로 한 번만 전송한다.
- `missing_context`는 필수 자료 누락 목록이다. 비어 있지 않으면 초안은 저장 가능하지만 승인은 차단한다.
- 비밀값 패턴 검사는 보조 장치다. 모든 개인정보·회사 기밀을 탐지한다는 보장은 없다.
- capture ID는 덮어쓸 수 없다. 원문·자료가 바뀌면 새 ID로 capture하고 이전 기록은 보존한다.

### Confluence 자료

로컬 파일 대신 다음 참조를 사용할 수 있다.

```json
{"source_id":"design","project_id":"demo","page_id":"123","version":3,"max_age_minutes":60}
```

기존 `atlassian context demo`로 받은 로컬 캐시만 읽는다. 설정의 사이트·클라우드·공간·허용 페이지와
버전·수집 시각을 확인한다. TTL은 최대 1440분이다. capture는 원격 페이지를 새로 조회하지 않으므로
**현재 원격 버전과의 일치까지 보장하지 않는다.** 오래된 캐시는 기존 MCP 연결 경로로 갱신한다.

## 2. 공통 출력 계약

대화형 AI와 API는 같은 [프롬프트/스키마](../prompts/templates/planning-quality.md)를 사용한다.
출력은 `plan`, `facts`, `proposals`, `questions`, `paths`, `relations`를 가진 JSON이다.

| 필드 | 의미와 검사 |
|---|---|
| `plan.tickets` | 프로젝트, 위험도/근거, 범위/제외, 수용 기준, 구현 단계, 테스트 계획, 승인된 검증 명령 |
| `facts` | `source_id`와 줄 번호 및 정확한 인용. 실제 존재하는 인용인지 검사 |
| `proposals` | 신규 제안임을 구분하고 요청 원문의 부분 문자열에 연결. 티켓마다 최소 하나 |
| `questions` | 영향받는 티켓과 `blocking`. 필수 질문이 남으면 승인 불가 |
| `paths` | `existing`은 동일 프로젝트의 입력 스냅샷에 있어야 함. `new`는 새 경로 제안 |
| `relations` | `git_dependency`, `document`, `related`. 모든 `depends_on`을 Git 선행 관계로 안내 |

최대 20개 티켓, 출력 96KB다. 알 수 없는 티켓 필드를 조용히 버리지 않고 거부한다.
기획/설계 `ticket_kind`는 기존 deliverables 계약도 충족해야 한다.
단위·통합·회귀·수동 테스트 배열은 모두 존재해야 하며 하나 이상에 검증 항목을 둔다.
티켓의 기본 시도 한도는 기존 3회다. 아래 API 생성 호출 한도와는 별개다.

```bash
node tools/harness-cli/index.js request draft login-tests --output-file .harness/local/planning-output.json
node tools/harness-cli/index.js request planning login-tests
# 사용자 계획 승인 후에만:
node tools/harness-cli/index.js request approve login-tests
node tools/harness-cli/index.js request ready login-tests
```

`ready: true`는 구조 검사 결과이지 사람의 승인이 아니다. 검수 전에는 DRAFT다.
소스·프로필·계획·근거가 달라지거나 근거 파일이 사라지면 관리형 승인/실행 진입을 거부한다.
오래된 기록은 `request planning`으로 열람할 수 있지만 승인을 재사용할 수는 없다.

### 수정과 Jira 연결

- 같은 입력에서 계획을 고칠 때는 출력 JSON을 수정해 `request draft`를 재실행한다. 이전 근거는 연결·보존한다.
- 같은 티켓의 Jira 출처는 수정 JSON에서 생략해도 보존한다. 연결된 티켓의 프로젝트나 Jira 출처를 바꾸는 수정은 거부한다. 새 초안은 다시 검수해야 하며 Jira 게시나 실행을 자동으로 승인하지 않는다.
- 중요도/재시도 변경도 새 draft로 검사한다. 품질 계획의 기존 `priority/revise` 직접 변경은 거부한다.
- 승인 후 계획 변경은 새 요청으로 검토한다. 승인 상태를 직접 되돌리지 않는다.
- 기존 승인형 `queue-ticket -> preview -> sync -> link` 흐름은 유지된다. 게시 자체가 실행 승인은 아니다.
- `link`는 확인된 Jira 출처만 연결하고 새 근거 지문을 만든다. 구현 내용까지 바뀌면 거부한다.
- 관계는 검수 요약에 보존되지만 모든 Jira issue link를 자동 생성하는 기능은 아니다.
- `draft`와 실제 `generate` 성공 시 기존 알림 outbox에 검토 요청을 기록한다. 구조 검사 통과는 `PLAN_READY`, 필수 질문/자료 누락은 `PLAN_INPUT_REQUIRED`로 구분한다. dry-run은 알리지 않는다. 알림 재전송은 계획 생성이나 Jira 게시를 다시 실행하지 않는다.
- CLI 결과 JSON은 stdout, 알림 진단은 stderr로 분리한다. 알림 채널이 미설정이거나 실패하면 outbox에 PENDING으로 남는다.

## 3. 사람 검수 기록

상세 근거를 읽고 아래 검수 JSON을 작성한다. 티켓별 필수 조건·사실 주장·질문이 필요한 상황 목록을
먼저 정한 뒤 개수를 기록한다. 원문 목록은 검수 사유/동반 검토 자료에 남긴다.

```json
{
  "fingerprint": "현재 planning_evidence.fingerprint 값",
  "result": "changes-requested",
  "reason": "경계값 테스트 누락. 필수 조건: 성공·실패·경계값.",
  "minutes": 3,
  "tickets": [{
    "ticket_id": "login-test", "required_total": 3, "omissions": 1,
    "claims_total": 2, "unsupported_claims": 0,
    "boundary_total": 0, "boundary_correct": 0,
    "unnecessary_questions": 0, "content_edits": 1
  }]
}
```

```bash
node tools/harness-cli/index.js request planning-review login-tests --review-file .harness/local/planning-review.json
```

이는 인간이 제공한 평가이지 의미적 정답률 자동 측정이 아니다. 분모 0의 비율은 `null`이다.
검수는 별도 불변 기록으로 남으며 수정 후 이전 fingerprint로 검수하면 거부된다.
`accepted` 검수 기록도 계획 승인 또는 Git 승인을 대신하지 않는다.

## 4. 선택형 API 생성

키가 없어도 대화형 capture/draft는 동작한다. API 생성의 기본값은 미전송 dry-run이다.

```bash
node tools/harness-cli/index.js request generate login-tests --provider openai
```

공급자는 `openai`, `anthropic`, `gemini`다. 모델은 기존 라우터/설정을 사용한다.
입력 위험도 기본값은 medium이며 high 입력에 fast를 지정하면 호출 전에 거부한다.
실제 호출은 비용·자료 전송 승인 후에만 아래 모든 조건을 충족해야 한다.

```text
HARNESS_AGENT_MODE=api
request generate login-tests --provider openai --live --approve-send --max-requests 1 --input-fingerprint <capture에서-확인한-지문>
```

요청 1회, HTTP 자동 재시도 없음, 출력 최대 4096 토큰, 전송 타임아웃 60초다.
큰 계획을 한 번에 모두 생성한다는 보장은 없다. 응답이 잘리거나 JSON/계약 검사가 실패하면 실패로 남긴다.
실패 근거 확인 후에만 재호출한다. CLI 실행별 1회 한도이며 월 누적 지출 상한은 아니다.
API 대기 중 초안이 생성·수정·승인되면 늦게 도착한 응답은 현재 계획에 적용하지 않는다.
동시 변경 오류와 응답을 로컬 시도 기록에 남기므로 현재 계획을 확인한 뒤에만 다시 요청한다.
실행 전 STARTED, 응답 수신/검증 실패 기록을 남겨 중단을 성공으로 처리하지 않는다.
대화형 모델명·토큰·지연은 호스트가 제공하지 않으면 unknown/null이며 API 관측치와 섞지 않는다.

## 5. 기존 평가 엔진 확장

기존 `eval`의 3개 사례/결과는 보존한다. 새 유형만 `eval planning`으로 선택한다.

```bash
node tools/harness-cli/index.js eval planning list
node tools/harness-cli/index.js eval planning run --provider openai --model MODEL_NAME
node tools/harness-cli/index.js eval planning import --responses-file .harness/local/captured-responses.json
node tools/harness-cli/index.js eval planning show EVAL_ID
node tools/harness-cli/index.js eval planning compare EVAL_ID_1 EVAL_ID_2
node tools/harness-cli/index.js eval planning review EVAL_ID --fingerprint RESULT_FINGERPRINT --result changes-requested --reason "근거 해석 재검토" --minutes 4
```

import 형식: `[{"id":"single-project","text":"모델 출력 JSON 문자열"}]`.
정적 작성 응답도 가능하므로 출처는 `captured-response`, 모델/토큰/지연은 unknown/null이다.
목록의 기대 조건/rubric은 사람 검수용이다. API에는 `input`만 보내며 정답은 보내지 않는다.

- 단일 프로젝트, 다중 프로젝트, 의존관계, 누락 규칙, 문서 내 지시 주입, 미지원 기능의 6개 합성 사례.
- 기본 `run`은 개발용 3개만 사용한다. 보류 사례는 `--cases ID,ID`로 명시적으로 선택한다.
- 보류 사례를 보고 튜닝하면 개발용으로 옮기고 새 보류 사례를 확보한다.
- live 평가도 별도 승인과 API 모드, `--live --max-requests N`이 필요하다. 기본 1회, 최대 3회/사례, 총 요청 1~9회.
- 명시한 고정 모델로 입력/프롬프트/오라클/루브릭/예산이 같은 조건을 비교한다. API와 import 결과는 비교하지 않는다.
- 구조 통과와 의미 품질은 다르다. 잘못된 해석도 형식·인용만 맞으면 통과할 수 있음을 테스트로 명시한다.
- 실측 전에는 누락률 개선, 환각 감소, 모델 우열, 토큰 절감률을 주장하지 않는다.

## 6. 저장·복구·검증

입력/초안/검수는 `.harness/local/planning/`, 계획은 `.harness/local/requests/`, 평가는 `.harness/local/evals/`다.
모두 Git ignored다. 기존 암호화 백업의 `.harness/local` 수집 범위이며 비밀 파일 제외·용량·링크 제한은 유지된다.
백업 복원은 격리 자료 복원이지 다른 PC의 실행/승인을 자동 재사용하는 권한이 아니다.
해시는 변경 탐지와 관리형 승인 결속이며 전자서명/OS 샌드박스는 아니다.

```bash
node --test tests/harness-cli/planning-quality.test.js
npm run lint
node tests/harness-cli/run.js
node tools/harness-cli/index.js verify --full --offline --task planning-quality-rehearsal
```

PowerShell에서 `npm.ps1`이 차단되면 `npm.cmd` 또는 Node 직접 호출을 사용한다.
모의 테스트는 실제 모델 품질·실계정 게시·다른 OS CI 통과를 의미하지 않는다.
