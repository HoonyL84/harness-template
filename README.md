# Harness Engineering Template

AI 코딩 에이전트(Cursor, Claude Code 등)를 다중 저장소 작업에 사용할 때 발생하는 **맥락 유실, 범위 이탈 수정, 검증 누락을 통제하기 위한 파일 기반 AI Engineering Control Plane**입니다.  
외부 DB 서버 없이 개인 개발자의 로컬 다중 저장소 환경에서 즉시 동작하며, 여기서 구현한 **계획 지문 동결·격리 실행·감사 원장 구조**는 팀 단위 에이전트 거버넌스로 그대로 일반화됩니다.

- **문제 (Problem):** 대화창 중심의 AI 개발은 승인한 계획과 실제 수정 파일의 일치 여부, 테스트 통과 근거, 실패 원인이 구조화된 기록으로 남지 않고, 반대로 모든 단계를 수동 검수하면 저위험 반복 작업에서 승인 피로도(Approval Fatigue)가 발생합니다.
- **해법 (Solution):** 작업을 **계획·승인·격리 실행·검증·검수·릴리스·이력**의 원자적 상태 전이로 분리하되, 저위험 작업은 허용 경로(`owned_paths`)·완전 검증(`verify --full`)·재시도 예산 안에서 중간 검수를 건너뛰는 **승인 패스(Fast-Track)**로 실행합니다.
- **핵심 수치 (Verified Metrics):**
  1. **설계상 수동 승인 게이트 축소 (`4단계 → 1단계`):** 저위험 티켓에서 `계획 → 구현 → 검수 → 릴리스` 4번의 수동 확인을 **최종 Git 반영 승인 1회**로 축소 (고위험 변경·동일 에러 2회 반복 시 즉시 `BLOCKED` 강등).
  2. **검증 표본 (`66개 완료 티켓 / 374개 자동화 테스트`):** 단일 저장소 완료 티켓 **66건**(`.harness/tasks/archive/`), 계약·장애 주입 테스트 **374건**(`tests/harness-cli/`), 다중 프로젝트(Java/Node) 및 Jira·Confluence 실계정 리허설 통과.
  3. **결정론적 컨텍스트 예산 (`티켓당 64KB / 최대 12개 파일`):** 필수 안전 계약을 보존하면서 키워드 적합도(`relevance_score`) 기반으로 문서를 선별하고, 예산 초과 시 임의 절단 대신 즉시 중단.

```text
[1. 계획 (Plan)]           ➔  [2. 구현 (Implement)]  ➔  [3. 검증·검수 (Verify & Review)]  ➔  [4. 반영·이력 (Release & Audit)]
 1단계: 계획 (planner/architect) 3단계: 격리 실행         4단계: 검증 (verifier)               6단계: Git 반영 (release)
 2단계: 승인 (Human Gate)               (implementer)     5단계: 검수 (reviewer / 승인 패스)    7단계: 이력 (recorder/memory)
```

- **왜 만들었나:** 반복되는 맥락 전달·작업 추적·검증 근거 정리 → [해결하는 문제](#해결하는-문제) / [실측 검증 요약](#실측-검증-요약-및-실제-실행-산출물)
- **어떻게 통제하나:** 승인 패스 조건, 서킷 브레이커, 핵심 알고리즘 → [자율성 레벨과 승인 패스](#자율성-레벨과-승인-패스-bounded-autonomy) / [핵심 알고리즘](#핵심-알고리즘-경로-통제컨텍스트-선별에러-지문화)
- **어디까지 보장하나:** 코드로 강제하는 경계와 미지원 범위(다중 사용자 RBAC 등) → [지원 범위와 한계](#지원-범위와-한계)

---

## 목차

- [실측 검증 요약 및 실제 실행 산출물](#실측-검증-요약-및-실제-실행-산출물)
- [해결하는 문제](#해결하는-문제)
- [구조와 책임 분리](#구조와-책임-분리)
- [자율성 레벨과 승인 패스 (Bounded Autonomy)](#자율성-레벨과-승인-패스-bounded-autonomy)
- [핵심 알고리즘 (경로 통제·컨텍스트 선별·에러 지문화)](#핵심-알고리즘-경로-통제컨텍스트-선별에러-지문화)
- [실제 사용 흐름](#실제-사용-흐름)
- [설치와 프로젝트 등록](#설치와-프로젝트-등록)
- [승인과 변경 탐지](#승인과-변경-탐지)
- [격리 실행과 의존관계](#격리-실행과-의존관계)
- [Jira·Confluence·알림](#jiraconfluence알림)
- [기록 검색과 다른 PC](#기록-검색과-다른-pc)
- [실패와 복구](#실패와-복구)
- [테스트와 AI 품질 평가](#테스트와-ai-품질-평가)
- [구현 위치와 설계 선택](#구현-위치와-설계-선택)
- [지원 범위와 한계](#지원-범위와-한계)

---

## 실측 검증 요약 및 실제 실행 산출물

설계상의 게이트 축소(`4단계 → 1단계`)와 별개로, 이 저장소에서 실제로 실행·검증된 기록([`PERSONAL_OPERATIONS_VALIDATION.md`](docs/project/PERSONAL_OPERATIONS_VALIDATION.md))은 다음과 같습니다.

| 검증 범주 | 표본 및 범위 (`n`) | 통과 결과 | 검증 내용 및 중단(BLOCKED) 사유 확인 | 근거 위치 |
| :--- | :--- | :--- | :--- | :--- |
| **단일 저장소 아카이브 티켓** | **66건** | **66 / 66 완료** | 하네스 코어·역할·평가지표·런타임 구현 및 `verify --full` 통과 이력 | [`.harness/tasks/archive/`](.harness/tasks/archive/) |
| **계약·장애 주입 자동화 테스트** | **374건** (42개 스위트) | **374 / 374 PASS** | Lease 동시성 충돌, 동일 에러 2회 반복(`same-error-repeat`), 고위험 경로(`APPROVAL_REQUIRED`), 지문 불일치, 원격 응답 유실(`SENDING`) 차단 검증 | [`tests/harness-cli/`](tests/harness-cli/) |
| **다중 프로젝트 실코드 검증** | **3개 저장소 / 6개 티켓** | **전 건 검증 통과** | `harness-template`(Node), `ad-server-engine`(Java 21/Spring), `harness-payment-service` 간 티켓 분해 및 단위 테스트(15건 등) 통과 | `.harness/local/requests/` |
| **계획 품질 루브릭 평가** | **9개 고정 사례** | **9 / 9 PASS** | 요구사항 분해, 선행 의존성, 범위 외 수정 억제, 필수 질문 누락 여부 채점 | [`planning-eval.js`](tools/harness-cli/planning-eval.js) |
| **실계정 외부 연동 리허설** | **Jira 2건 · Confluence 2건** | **생성·조회·연결 확인** | 실제 Atlassian 클라우드 계정 대상 티켓/문서 게시 및 로컬 원장 대조 | [`PERSONAL_OPERATIONS_VALIDATION.md`](docs/project/PERSONAL_OPERATIONS_VALIDATION.md) |

<details>
<summary><b>실제 생성된 멀티 프로젝트 티켓 JSON 및 검증 기록 예시 보기 (클릭)</b></summary>

아래는 `ad-server-engine` 저장소의 2-Tier 광고 매칭 고도화 요청에서 생성·검증된 실제 티켓 스펙(`.harness/local/requests/ad-domain-ml-upgrade.json` 발췌)과 실행 검증 결과입니다.

```json
{
  "ticket_id": "ad-2tier-matching",
  "project_id": "ad-server-engine",
  "title": "1단계: 2-Tier 매칭 고도화 (LLM Query Expansion & Floor Price 필터)",
  "status": "REVIEW_READY",
  "priority": "P0",
  "risk": "medium",
  "execution_mode": "fast-track-eligible",
  "retry_policy": {
    "max_attempts": 3,
    "stop_on_same_error": true
  },
  "owned_paths": [
    "src/main/java/com/example/adengine/matching/",
    "src/test/java/com/example/adengine/matching/",
    "study/03_two_tier_matching_engine.md"
  ],
  "verification_commands": [
    ".\\gradlew.bat test --tests com.example.adengine.matching.*"
  ],
  "dependencies": []
}
```

```text
[Execution & Verification Log Summary]
- Request / Ticket : ad-domain-ml-upgrade / ad-2tier-matching
- Owned Paths Check: PASS (5 files modified within src/*/adengine/matching/ and study/03_*)
- High-Risk Check  : PASS (no DDL, infra, auth, or unapproved path segments touched)
- Command Executed : .\gradlew.bat test --tests "com.example.adengine.matching.*" --tests "com.example.adengine.ranking.*" --tests "com.example.adengine.attribution.*"
- Verification     : PASS (Exit Code 0, 15/15 unit tests passed, 0 retries needed)
- Release Gate     : GitHub PR #1 merged (commit b687703) after human approval
```
</details>

---

## 해결하는 문제

대화창에 개발을 맡기는 것만으로는 프로젝트별 배경, 계획 수정, 검증 결과, 실패 이력과 Git 승인이 일관되게 남지 않습니다. 다음 작업이나 다른 대화에서 사람이 다시 맥락을 설명하고 이전 결과를 확인해야 합니다.

하네스는 그 반복 업무를 파일 기반의 재현 가능한 흐름으로 만듭니다.

| 사람이 하던 반복 업무 | 하네스가 지원하는 일 | 사람이 계속 책임지는 일 |
| --- | --- | --- |
| 프로젝트마다 배경과 검증 방법 설명 | 프로젝트 등록, 승인된 프로필, 선택 문서 번들 | 실제 업무 규칙과 검증 명령의 적합성 |
| AI가 제안한 작업을 정리하고 추적 | 상세 티켓·의존관계·테스트 계획·수정 근거 저장 | 요구사항 누락, 범위, 위험도와 우선순위 판단 |
| 작업 폴더/브랜치 준비, 테스트 실행 | 승인된 티켓별 worktree, 실행 기록, 제한된 재시도 | 고위험 변경 승인, 막힌 원인에 대한 결정 |
| Jira·문서·알림 상태를 수동 전달 | 동의한 범위의 후속 게시와 채널별 알림 | 외부 게시 범위와 회사 정보 반출 허용 여부 |
| 완료 내역을 다시 찾아 정리 | 프로젝트·기간·기술·티켓별 검색 및 근거 출력 | 최종 코드 검수, Git 반영과 공개 내용 승인 |

---

## 구조와 책임 분리

```text
사용자: 목표·제약 전달 / 계획·결과·Git 반영 승인
   |
대화형 AI 또는 선택형 모델 API: 자료 해석, 계획/패치 제안
   |
Harness Node CLI: 계약 검사, 상태·예산·승인·증거 관리
   |-- 프로젝트 A Git worktree / 승인된 검증 명령
   |-- 프로젝트 B Git worktree / 승인된 검증 명령
   |-- 로컬 컨텍스트·실행·검수·릴리스 원장
   `-- 선택형 Jira / Confluence / Telegram / Slack
```

- **AI**는 요청을 해석하고 상세 계획과 구현을 제안합니다.
- **하네스 코드**는 허용 프로젝트·경로·검증 명령·의존관계·승인 지문과 상태 전이를 검사합니다.
- **프로젝트 테스트/빌드**는 승인된 요구사항을 검증하는 근거입니다.
- **사람**은 요구사항 경계, 고위험 판단, 최종 수락과 릴리스 책임을 가집니다.

중앙 하네스와 관리 대상 프로젝트는 별도 저장소입니다. 기존 프로젝트에 하네스 전체를 복사하지 않아도 등록·프로필 승인으로 연결할 수 있습니다.

### 4대 국면과 7단계 세부 상태·역할(Role)·스킬(Skill) 매핑

상단 요약 다이어그램의 **4대 국면(계획·구현·검증·반영)**은 내부적으로 **7개의 세부 상태 전이 단계**로 나뉘며, 각 단계는 에이전트 역할(`prompts/system/roles/`) 및 스킬(`skills/`)과 연결됩니다(1단계와 7단계는 복수 역할 수행).

| 상단 4대 국면 | 7단계 세부 흐름 | 주요 업무 | 담당 역할 (Role) | 호출 스킬 / 하네스 엔진 | 산출물 및 통제 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 계획** | **1단계: 계획 (Plan)** | 목표 구체화, 선행 의존성 및 테스트 계획 수립 | `planner`, `architect` | `request draft` 분석기 | `.harness/local/requests/` 티켓 사양 JSON |
| **1. 계획** | **2단계: 승인 (Approve)** | 변경 범위, 재시도 예산, 아키텍처 위험도 검토 | **사람 (Human Gate)** | `request approve` | SHA-256 지문 동결 (범위 이탈 변경 탐지) |
| **2. 구현** | **3단계: 격리 실행 (Execute)** | 작업 브랜치/Worktree에서 허용 경로 내 코딩 | `implementer` | Git Worktree 격리 실행기 | `.worktrees/` 격리 폴더 내 코드 구현 |
| **3. 검증** | **4단계: 검증 (Verify)** | 프로젝트 단위/통합 테스트, 린트, 빌드 실행 | `verifier` | 프로젝트 고유 검증 명령 | `harness verify --full` (Exit Code 0 확인) |
| **3. 검증** | **5단계: 검수 (Review)** | diff 기반 회귀·누락 점검 (저위험 시 승인 패스 가능) | `reviewer` / **사람** | `skills/code-review` | Severity별 Findings 또는 승인 패스 기록 |
| **4. 반영** | **6단계: Git 반영 (Release)** | 안전 정책 준수 하에 커밋, PR 발행 및 머지 | `release` | `docs/skills/git-workflow` | 단발성 릴리스 승인 소비 및 PR 병합 |
| **4. 반영** | **7단계: 이력 (Audit)** | 실행 이력, 메트릭, 의사결정 노트 갱신 | `recorder`, `memory` | `history refresh` 원장 기록기 | `.harness/local/history.jsonl` 감사 원장 |

---

## 자율성 레벨과 승인 패스 (Bounded Autonomy)

하네스는 모든 작업에 획일적인 수동 승인을 강제하지 않습니다. 작업 위험도(`risk`)와 검증 결과에 따라 사람의 개입 수준을 조절합니다.

### 용어 정의: L4.5와 L5

- **L4.5 (제한적 자동 수정, Bounded Auto-Fix):** 검증(`verify --full`) 실패 시 신규 파일 생성이나 보호 경로 침범 없이, **기존에 존재하는 허용 소스/테스트 파일 내부**에서 패치 크기 예산(기본 최대 3개 파일, 16KB) 이내로만 자동 수정을 재시도하는 기능입니다([`auto-fix-policy.md`](docs/design-docs/auto-fix-policy.md)).
- **L5 (승인 패스 자율 루프, Fast-Track Autonomy):** 사전 승인된 티켓의 소유 경로(`owned_paths`)와 재시도 예산(기본 최대 3회) 안에서 **구현 → 검증 → L4.5 수정을 연속 수행**하고, 검증을 통과하면 중간 사람 검수 단계를 건너뛰어 최종 Git 반영 승인 단계로 직행하는 모드입니다([`l5-autonomy-policy.md`](docs/design-docs/l5-autonomy-policy.md)).

### 1. 두 가지 실행 모드 비교 (Strict vs 승인 패스)

| 구분 | 표준 모드 (Strict Governance) | 승인 패스 모드 (Fast-Track: L4.5 / L5) |
| :--- | :--- | :--- |
| **적용 대상** | **고위험 작업:** DB 스키마(DDL), 마이그레이션, 인프라(`infra/k8s/terraform`), 인증/보안(`auth/security`), 결제(`payment/billing`), 외부 유료 API | **저위험 / 명확한 스펙 작업:** 단위 기능 구현, 버그 픽스, 테스트 코드 보강, 소유 경로 내 리팩터링 |
| **설계상 수동 게이트** | **4단계 수동 확인:** 계획 승인 ➔ 구현 착수 확인 ➔ 결과 검수 수락 ➔ Git 릴리스 승인 | **1단계 수동 확인 (중간 검수 패스):** 초기 계획에서 승인 패스를 허용하면, 검증 통과 시 중간 수락을 건너뛰고 **최종 Git 릴리스 승인 1회**만 수행 |
| **통제 경계** | 하네스 CLI 경로에서 미승인 상태 전이 및 지문 불일치 차단 | 허용 경로·검증 통과·예산 조건을 모두 충족할 때만 중간 검수 생략 허용 (이탈 시 즉시 `BLOCKED` 전환) |

### 2. 승인 패스 작동 조건과 서킷 브레이커 (Circuit Breaker)

- **승인 패스 3대 필수 조건:**
  1. **소유 경로 준수 (`owned_paths`):** 티켓 계획에 승인된 파일 경로 내부만 수정할 것.
  2. **완전 검증 통과 (`verify --full`):** 프로젝트의 테스트·린트·빌드 명령이 Exit Code 0으로 통과할 것.
  3. **재시도 예산 준수 (`Retry Budget`):** 티켓에 설정된 최대 시도 횟수(기본 3회) 및 L4.5 패치 한도 이내일 것.
- **비상 정지 서킷 브레이커 (`BLOCKED` 강등):**
  - 승인 패스 모드로 실행 중이더라도 **(1) 동일한 에러가 2회 연속 반복(`same-error-repeat`)**되거나, **(2) 고위험 경로 세그먼트 변경(`APPROVAL_REQUIRED`)이 감지**되면 남은 재시도 횟수를 소진하지 않고 **즉시 `BLOCKED` 상태로 전환**하여 사람을 호출합니다.

---

## 핵심 알고리즘 (경로 통제·컨텍스트 선별·에러 지문화)

래퍼(Wrapper)를 넘어 컨트롤 플레인이 결정론적으로 동작하기 위해 다음 3가지 핵심 로직을 코드로 구현했습니다.

### 1. `owned_paths` 소유권 검증 및 고위험 경로 차단 ([`agent-runner.js`](tools/harness-cli/agent-runner.js), [`orchestration-command.js`](tools/harness-cli/orchestration-command.js))

1. **경로 정규화 및 프리픽스 매칭 (`pathIsOwned`):** 수정된 파일 경로의 백슬래시(`\`)를 `/`로 정규화하고, 티켓에 선언된 `owned_paths` 배열과 정확히 일치하거나 하위 디렉터리 프리픽스(`owned.endsWith("/")`)에 속하는지 검사합니다.
2. **보호 경로 및 패치 형태 검사 (`validateRunnerPatch`):**
   - `.git/`, `.harness/`, `node_modules/`, `.env*` 접근, 상위 경로 이탈(`..`), Git 심볼릭 링크(`120000`), 바이너리 패치를 즉시 거부합니다.
   - L4.5 `auto-fix` 단계에서는 `fs.existsSync`로 기존 파일 존재 여부를 확인하여 **신규 파일 생성을 차단**하고, `config.autoFix.maxFiles`(기본 3개) 및 `maxPatchBytes`(기본 16KB)를 넘으면 중단합니다.
3. **고위험 세그먼트 감시:** 패치 경로에 `db/schema`, `migration`, `infra`, `terraform`, `k8s`, `auth`, `security`, `payment`, `billing` 세그먼트가 포함되면 재시도 루프를 즉시 멈추고 `APPROVAL_REQUIRED`로 분류합니다.

### 2. 서킷 브레이커의 '동일 에러 2회 반복' 판정 ([`agent-runner.js#L31-L34`](tools/harness-cli/agent-runner.js))

실행 실패 시 에러 문자열의 앞뒤 공백과 연속된 공백/줄바꿈을 단일 공백(`" "`)으로 정규화한 뒤 SHA-256 해시를 계산합니다.

```javascript
function fingerprintError(error) {
  const normalized = String(error?.message || error || "unknown error").trim().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
```

- 매 시도 실패 시 `error_fingerprint`를 기록하고, `retry_policy.stop_on_same_error !== false`(기본값 `true`)인 상태에서 `ticket.runner.last_error_fingerprint === errorFingerprint`가 성립하면 **2번째 동일 에러에서 즉시 루프를 종료**하고 `blocked_reason = "same-error-repeat"`로 상태를 고정합니다.

### 3. 컨텍스트 선별·압축 및 모델 티어 라우팅 ([`project-context.js`](tools/harness-cli/project-context.js), [`model-router.js`](tools/harness-cli/model-router.js))

별도의 벡터 DB 없이 로컬 파일시스템에서 즉시 재현 가능하도록 **우선순위 트리(P0~P9) + 키워드 토큰 적합도(`relevance_score`)** 알고리즘을 사용합니다.

1. **우선순위 및 키워드 점수 결합 (`selectTicketFiles`):**
   - 문서를 `instructions(P0) → plan(P1) → context-file(P2) → active-task(P3) → design/ADR(P4~5) → working/semantic/procedural/episodic 메모리(P6~9)` 순으로 분류합니다.
   - 티켓의 `title`, `goal`, `scope`, `owned_paths`에서 추출한 3글자 이상 키워드 토큰이 후보 문서의 경로·본문에 매칭되는 횟수로 `relevance_score`를 계산해, 동일 계층 내에서 관련도가 높은 문서부터 **64KB(최대 12개 파일) 예산** 안에 채웁니다.
   - 필수 안전 계약(`AGENTS.md`, `safety-contract.md`, `PLANS.md`)은 `required: true`로 고정하며, 필수 문서만으로 예산이 초과되면 문서를 임의로 자르지 않고 에러로 중단합니다.
2. **비신뢰 입력 정규식 필터 (`detectContextRisks`):** 외부 프로젝트 문서와 Jira/Confluence 본문은 `untrusted-project-input`으로 격리하고, 시스템 지시 무시(`policy-override`), 환경변수/키 유출(`secret-access`), 파괴적 명령 유도(`tool-escalation`) 패턴을 스캔합니다.
3. **실패 이력 연동 모델 라우팅 (`resolveModelTier`):** 작업 역할(`architect / implementer / reviewer`), 위험도(`low / medium / high`), 중요도(`P0~P3`), 범위 크기(`scopeCount`), 그리고 **재시도 횟수(`attempt >= 2`) 및 수선 필요 여부(`repairRequired`)**를 조합해 `fast / standard / strong` 티어를 결정론적으로 선택합니다. 1차 시도 실패 후 재시도 시 상위 모델 티어로 자동 승격하며, 고위험 티켓에 `fast` 티어를 강제 지정하면 거부합니다.

---

## 실제 사용 흐름

사용자가 대화창에 자연어로 작업을 지시하면, AI는 바로 코드를 수정하지 않고 티켓 후보와 **위험도(`risk`), 재시도 횟수(`max_attempts`), 승인 패스(Fast-Track) 가능 여부**를 먼저 리턴합니다.

1. **사용자 요청:** *"결제 실패 재시도 테스트를 보강하고, 광고 서버의 이벤트 처리도 관련 있으면 같이 확인해줘."*
2. **AI 티켓 후보 리턴:**
   - `payment-retry-test` (`risk: low`, `max_attempts: 3`, **승인 패스(Fast-Track) 권장**)
   - `ad-event-check` (`risk: medium`, `max_attempts: 3`, 선행 관계 및 확인 질문 제시)
3. **사람의 조건 조정 및 승인:** *"결제 테스트 티켓은 승인 패스로 바로 진행하고, 광고 서버 티켓은 재시도 2회로 줄여서 진행해줘."*
4. **하네스 통제 실행:** 지정된 재시도 예산과 승인 패스 설정을 계획 JSON에 동결(`approve`)한 뒤, 격리된 worktree에서 구현 및 `verify --full` 검증을 수행합니다.

### 계획에서 실행까지의 상태 전이

```text
입력 스냅샷 → 상세 초안 DRAFT → 계획 검수/수정 → APPROVED
                                               |
                                  실행 준비 PREPARED
                                               |
                                      RUNNING + 검증 (verify --full)
                                       /          \
                                  BLOCKED      REVIEW_READY ──[승인 패스 (Fast-Track)]──┐
                                                  |                                    |
                                       사람의 결과 수락 (Strict)                        |
                                                  |                                    ▼
                           별도 Git 승인 → APPLYING <──────────────────────────────────┘
                                              |
                                           APPLIED
```

> **왜 CLI 상태 전이를 세분화했는가? (대화형 UX와 원자적 감사 경계의 분리)**  
> 사람은 대화창에서 자연어로 지시·승인만 내리고, 아래의 세분화된 CLI 명령어는 AI 에이전트가 백그라운드에서 호출하는 **시스템 콜(System Call)** 역할을 합니다. 상태를 원자적으로 쪼갠 이유는 비결정적인 AI가 어느 단계에서 규칙 위반이나 검증 실패를 일으켰는지 정확히 격리(Fault Isolation)하고, 실패 지점부터만 재개(Resume)하기 위함입니다.

<details>
<summary><b>백그라운드 CLI 상태 전이 및 컨텍스트/프로바이더 명령어 보기 (클릭)</b></summary>

```bash
# 1. 계획 캡처·초안·검수·승인·격리 실행 준비
npm run harness -- request capture work-01 --input-file .harness/local/input.json
npm run harness -- request draft work-01 --output-file .harness/local/output.json
npm run harness -- request planning work-01
npm run harness -- request planning-review work-01 --review-file .harness/local/review.json
npm run harness -- request approve work-01
npm run harness -- request ready work-01
npm run harness -- execution prepare work-01

# 2. 컨텍스트 번들 및 프로바이더 상태 조회
npm run harness -- context --json
npm run harness -- provider status
npm run harness -- provider usage --json
```

- **대화형 모드:** 현재 IDE/대화창의 AI가 승인된 worktree에서 구현하고 `execution review-ready`로 프로젝트 검증을 수행합니다.
- **API 모드:** 키와 모델 설정 후 `runner run work-01 --ticket TICKET_ID`가 패치 생성·검사·적용·검증을 수행합니다.
- **결과 수락과 Git 반영:** `history review --result accepted` 기록 후 `release request` → `release approve` → `release apply`로 단발성 Git 승인을 소비합니다.
</details>

---

## 설치와 프로젝트 등록

필수 도구는 **Node.js 24, npm, Git**입니다. Windows·macOS·Linux에서 동일한 Node CLI를 사용합니다. (PowerShell에서 `npm.ps1`이 차단된 경우 `npm.cmd` 또는 `node tools/harness-cli/index.js`를 사용합니다.)

```bash
git clone https://github.com/HoonyL84/harness-template.git
cd harness-template
npm ci
npm run harness -- check

# 외부 프로젝트 등록 및 온보딩 승인
npm run harness -- project add sample --path "/absolute/path/to/project"
npm run harness -- project onboard sample
npm run harness -- project onboard sample --approve
npm run harness -- project context sample --bundle
```

원본 프로젝트에 미커밋 변경이 있거나 등록 시점의 기준점(HEAD)이 바뀌면 실행 준비를 멈추고 확인을 요청합니다. API·알림 키는 `.env.local`에만 보관하며 커밋이나 티켓에 기록하지 않습니다.

---

## 승인과 변경 탐지

Fingerprint는 승인한 입력과 실제 실행 대상이 달라졌는지 검사하는 SHA-256 기반 변경 탐지값입니다.

| 지문/기록 | 결속하는 주요 내용 | 변경되면 |
| --- | --- | --- |
| 계획·계획 근거 | 프로젝트, 티켓, 범위(`owned_paths`), 위험도, 검증 명령, 의존관계와 출처 근거 | 재검토/재승인 필요 |
| 저장소 콘텐츠 | Git 상태 출력, 추적 파일과 ignore되지 않은 미추적 파일의 경로·내용/링크 정보 | 이전 검증/콘텐츠 승인 재사용 차단 |
| 릴리스 승인 | 승인 ID, 요청/실행, Git 작업·메시지·대상 브랜치, worktree·기준점·검수 근거 | 다른 작업에 승인을 전용할 수 없음 |
| Jira 입력 | 프로젝트와 이슈 식별, 제목·본문·우선순위 등 현재 구현이 결속하는 필드 | 실행/관리형 릴리스 전에 변경 여부 확인 |

릴리스는 적용 전에 승인을 소비하는 상태로 전환합니다. 적용 중 실패하면 이전 승인을 재사용하지 않고 실패·부분 결과를 남깁니다.

---

## 격리 실행과 의존관계

- **Worktree 격리:** 티켓별 branch와 `.worktrees/` 폴더를 분리하여 원본 작업 공간을 오염시키지 않습니다. (단, 파일시스템 격리이므로 DB·포트·외부 서비스 자원은 프로젝트 테스트 설정에서 분리해야 합니다.)
- **Runner Lease와 시도 횟수 선기록:** 모델 호출/파일 변경 전에 시도 횟수를 먼저 저장하여 중단된 호출을 누락하지 않습니다.
- **Commit SHA 기반 계보:** 선행 작업 의존성은 변하는 브랜치 이름 대신 기록된 commit SHA로 연결합니다. 동일 프로젝트의 다중 선행 브랜치 병합(fan-in)은 자동 merge하지 않고 별도 통합 티켓과 검증을 거칩니다.
- **멀티에이전트(기본 OFF):** 단일 writer가 기본이며, multi-writer는 명시적 opt-in·겹치지 않는 `owned_paths`·동일 기준 SHA·격리 worktree를 요구합니다.

---

## Jira·Confluence·알림

| 연결 | 역할과 승인 경계 |
| --- | --- |
| Jira | 상세 티켓·라벨·우선순위·상태 조회/반영. 카드 이동만으로 코드 실행이 승인되지는 않음 |
| Confluence | 프로젝트 맥락과 결과 문서 보관. 선택 페이지/버전·내용을 로컬 근거와 연결 |
| Telegram / Slack | 프로젝트가 구분된 계획·실패·검수 대기 알림. 알림 전송과 실제 실행은 별도 |
| MCP / REST | Atlassian은 MCP 우선, REST는 명시적 호환 선택 |

게시 outbox는 확실한 거절(`REJECTED`)과 응답 유실(`SENDING`, `NEEDS_RECONCILIATION`)을 구분합니다. 원격 처리 후 응답만 유실되었을 가능성이 있으면 중복 POST하거나 다음 상태로 덮어쓰지 않고 대조(reconcile)를 기다립니다.

---

## 기록 검색과 다른 PC

| 저장 위치 | 내용 |
| --- | --- |
| `.harness/tasks/` | 단일 저장소의 `backlog`, `active`, `review`, `blocked`, `archive` Markdown 티켓 |
| `.harness/local/` | 프로젝트 등록·프로필, 요청/실행, 승인, 검수/작업 이력(`history.jsonl`), outbox, 평가 결과 |
| `.worktrees/` | 관리형 티켓 작업 공간 |
| `observability/` | 검증·실행·사용량 로그와 메트릭 |
| `memory/`, `docs/` | 정책, 설계 결정, 프로젝트 문서와 4계층 메모리 노트 |

로컬 상태(`.harness/local/`)와 비밀값은 Git에서 제외합니다. 다른 PC로 이전할 때는 승인형 암호화 백업([`STATE_BACKUP.md`](docs/STATE_BACKUP.md)) 복원 후 경로 재등록과 기준점 검증을 수행하며, 복원된 과거 승인으로 새 환경의 작업을 자동 실행하지는 않습니다.

---

## 실패와 복구

실패 시 무조건 재시도하거나 `git reset --hard`로 작업 트리를 밀어버리지 않고, **Why + Safe Next Action**으로 원인 범주와 첫 확인 명령을 안내합니다.

| 상황 | 첫 확인 명령 | 확인 후의 판단 |
| --- | --- | --- |
| 실행 중단 또는 만료된 lease | `runner status REQUEST_ID` | 실행 주체·worktree·시도 기록 확인 후 필요할 때만 reconcile/승인형 복구 |
| 외부 게시 응답 유실 (`SENDING`) | `atlassian status` | 원격 marker·목적지·상태 확인 후 일치할 때 reconcile (미발견만으로 재POST 금지) |
| 확실한 외부 거절 (`REJECTED`) | `atlassian recovery ENTRY_ID` | 인증/요청 수정 후 명시적 `retry-rejected` 수행 |
| 검수 이후 파일/Jira 핵심 입력 변경 | `release status APPROVAL_ID` | 현재 입력/계획·검증·검수를 갱신하고 새 승인 요청 |

---

## 테스트와 AI 품질 평가

```bash
npm test
npm run coverage
npm run lint
npm run harness -- verify --full --task YOUR_ACTIVE_TICKET
npm run harness -- eval planning list
node tools/harness-cli/skill-eval.js --skill code-review --cases
```

- **실행 및 동시성 회귀 검증 (`tests/harness-cli/`):** `sleep` 대신 Promise barrier를 사용해, Runner A 실행 중 Runner B 진입 시 활성 lease 보호 여부, Jira 응답 유실 후 중복 전송 차단 여부, 승인 후 파일/요구사항 변경 시 Git 반영 차단 여부를 결정론적으로 검증합니다.
- **스킬 Oracle 자동 채점 ([`skill-eval.js`](tools/harness-cli/skill-eval.js)):** 골든 데이터셋(`examples.jsonl`)을 기준으로 스킬 선택(`selected_skill`), 결함 파일·라인·심각도(`P0~P3`) 적중 여부, 출력 스키마 준수를 채점합니다.
- **계획 품질 하이브리드 평가 ([`planning-eval.js`](tools/harness-cli/planning-eval.js)):** 9개 고정 합성 사례에서 JSON 계약·출처·경계는 코드로 자동 채점하고, 테스트 계획의 구체성과 범위 외 변경 여부는 사례별 루브릭으로 함께 기록합니다.

---

## 구현 위치와 설계 선택

| 책임 | 핵심 구현 | 설계 이유/절충 |
| --- | --- | --- |
| CLI·설정 | [index.js](tools/harness-cli/index.js), [config.js](tools/harness-cli/config.js) | 공통 Node 구현, 셸 래퍼는 호환용 |
| 계획·입력 근거 | [planning-contract.js](tools/harness-cli/planning-contract.js), [planning-command.js](tools/harness-cli/planning-command.js), [request-plan.js](tools/harness-cli/request-plan.js) | 구조 검증과 의미 검수 분리 |
| 컨텍스트 선별 | [agent-context.js](tools/harness-cli/agent-context.js), [project-context.js](tools/harness-cli/project-context.js) | P0~P9 우선순위 + 키워드 점수로 64KB 예산 내 압축, 필수 안전 계약 고정 |
| 실행·서킷 브레이커 | [agent-runner.js](tools/harness-cli/agent-runner.js), [project-execution.js](tools/harness-cli/project-execution.js) | Lease·시도 선기록·에러 SHA-256 지문 비교(`fingerprintError`)·소유 경로 검사 |
| 승인·Git 반영 | [control-plane-command.js](tools/harness-cli/control-plane-command.js), [governance-ledger.js](tools/harness-cli/governance-ledger.js) | 사람 검수와 단발 Git 승인 분리 |
| 영속성 | [control-plane-state.js](tools/harness-cli/control-plane-state.js) | 원자적 파일 저장과 로컬 잠금 |
| 게시·알림 | [operations-publish.js](tools/harness-cli/operations-publish.js), [runner-notifications.js](tools/harness-cli/runner-notifications.js) | 개발 결과와 외부 전달 실패 분리 |
| 이력·복구 안내 | [work-history.js](tools/harness-cli/work-history.js), [safe-next-action.js](tools/harness-cli/safe-next-action.js) | 조회 감사는 남기고 복구보다 상태 확인 우선 |
| 모델·평가 | [model-router.js](tools/harness-cli/model-router.js), [planning-eval.js](tools/harness-cli/planning-eval.js), [skill-eval.js](tools/harness-cli/skill-eval.js) | 위험도·재시도 기반 티어 라우팅과 루브릭/Oracle 평가 분리 |

---

## 지원 범위와 한계

**구현된 범위:** 개인 개발자의 로컬 다중 저장소 등록·온보딩, 상세 계획/검수 감사 기록, 위험도 기반 실행(Strict 수동 검수 및 L4.5/L5 조건부 승인 패스)·Git 반영, 이력 추적 및 선택형 외부 연동(OpenAI/Anthropic/Gemini API, Jira/Confluence, Slack/Telegram, 암호화 백업).

이 아키텍처가 다루는 문제(계획-실행 불일치 탐지, 소유 경로 격리, 실패 지점 재개, 감사 원장)는 팀 단위 AI 거버넌스로 일반화되지만, **현재 구현의 보장 범위와 한계는 다음과 같이 명확히 구분됩니다.**

- **다중 사용자 기능 미포함 (개인용 로컬 Control Plane):** 중앙 DB나 원격 인증 서버 없이 로컬 파일 잠금 기반으로 동작합니다. 다수의 개발자가 동시 접속하는 사내 플랫폼(IDP)으로 확장하려면 **사용자별 RBAC(역할 기반 접근 제어), 원격 중앙 잠금 서버(Distributed Lock), 조직 단위 SSO/서명 검증**이 추가로 필요합니다.
- **통제 경계 (Managed CLI vs OS Sandbox):** 하네스 CLI(`runner`, `execution`, `release`)를 거치는 관리형 경로에서는 미승인 변경과 소유 경로 이탈을 차단하지만, OS 커널 수준의 보안 샌드박스가 아니므로 사용자가 터미널에서 직접 실행하는 raw `git commit/push`나 직접 파일 편집까지 물리적으로 막지는 않습니다. Fingerprint는 변경 탐지용 해시이지 전자서명이 아닙니다.
- **AI 코어 및 평가 규모의 한계:** 컨텍스트 선별은 파일시스템 기반의 결정론적 우선순위·키워드 매칭(`selectTicketFiles`)으로 구현되어 있으며, AST 구문 파싱이나 임베딩 벡터 검색은 포함하지 않습니다. 또한 계획 평가(`planning-eval.js`)는 9개 고정 합성 사례와 인간 루브릭을 결합한 회귀 검증용이며, 대규모 온라인 LLM-as-a-Judge 파이프라인을 대체하지 않습니다.
- **측정 근거의 분리:** 설계상 수동 승인 게이트 수 축소(`4단계 → 1단계`)나 자동화 테스트 통과(`374건`)는 아키텍처 및 계약 검증 지표입니다. 장기 실사용에서의 실제 업무 시간·토큰·비용 절감률은 프로젝트별 운영 로그에서 별도로 측정해야 합니다.

---

## 상세 문서

- [전체 CLI 가이드](docs/HARNESS_GUIDE.md), [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)
- [계획 품질 계약](docs/PLANNING_QUALITY_GUIDE.md), [기획·설계 티켓](docs/PLANNING_TICKETS.md)
- [Atlassian 설정](docs/ATLASSIAN_MCP.md), [운영 상태와 비용](docs/OPERATIONS_STATUS.md)
- [티켓 컨텍스트 참조](docs/TICKET_CONTEXT_REFERENCES.md), [백업과 복원](docs/STATE_BACKUP.md)
- [운영 근거 보고서](docs/OPERATIONS_EVIDENCE_GUIDE.md), [운영 검증 기록](docs/project/PERSONAL_OPERATIONS_VALIDATION.md)
- [필수 안전 계약](docs/design-docs/safety-contract.md), [L4.5 자동 수정 정책](docs/design-docs/auto-fix-policy.md), [L5 자율 실행 정책](docs/design-docs/l5-autonomy-policy.md), [릴리스 정책](docs/RELEASE_SAFETY.md), [에이전트 진입 규칙](AGENTS.md)

전체 명령은 `npm run harness -- help --all`에서 확인할 수 있습니다.
