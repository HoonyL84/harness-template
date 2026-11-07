# Harness Engineering Template

AI 코딩 에이전트(Cursor, Claude Code 등)를 다중 저장소 작업에 사용할 때 발생하는 **맥락 유실, 범위 이탈 수정, 검증 누락을 통제하기 위한 파일 기반 AI Engineering Control Plane**입니다.  
외부 DB 서버 없이 개인 개발자의 로컬 다중 저장소 환경에서 즉시 동작합니다. 여기서 구현한 **계획 지문 동결·격리 실행·감사 원장 구조**는 팀 단위 에이전트 거버넌스로 일반화 가능한 구조이며, 다중 사용자 팀 환경으로 확장하려면 RBAC·원격 중앙 잠금·작성자 서명 검증이 추가로 필요합니다.

> **책임 범위 선언:** 하네스의 책임 범위는 검증과 감사 기록을 갖춘 **브랜치/PR 생성 및 병합 준비까지**입니다. 실제 서비스 운영 배포(CD)는 범위 밖이며, Git push나 PR 병합을 운영 배포 완료로 간주하지 않습니다.

- **문제 (Problem):** 대화창 중심의 AI 개발은 승인한 계획과 실제 수정 파일의 일치 여부, 테스트 통과 근거, 실패 원인이 구조화된 기록으로 남지 않고, 반대로 모든 단계를 수동 검수하면 저위험 반복 작업에서 승인 피로도(Approval Fatigue)가 발생합니다.
- **해법 (Solution):** 작업을 **계획·승인·격리 실행·검증·검수·릴리스·이력**의 원자적 상태 전이로 분리하되, 저위험 작업은 승인된 범위·완전 검증(`verify --full`)·재시도 예산 안에서 중간 검수를 건너뛰는 **승인 패스(Fast-Track)**로 실행합니다.
- **핵심 수치 (Verified Metrics):**
  1. **설계상 수동 승인 게이트 축소 (`4단계 → 2단계`):** 저위험 티켓에서 `계획 승인 → 구현 착수 → 결과 검수 → Git 릴리스 승인` 4번의 수동 확인 중 중간 2단계를 생략하고 **초기 계획 승인과 최종 Git 반영 승인 2회**로 축소 (고위험 경로 침범·동일 에러 2회 반복 시 즉시 `BLOCKED` 강등, 프로젝트 프로필의 `fast_track_allowed: true` 명시 승인 필요).
  2. **검증 모수 구분 (`외부 실프로젝트 3건 / 다중 저장소 리허설 3건 / 자체 개발 66건 / 자동화 테스트 375건`):** 외부 Java/Spring 프로젝트(`Ad-Server-Engine`) 실코드 병합 **2개 티켓** + 고위험 경로(`scripts/deploy.sh`) 침범 시 서킷 브레이커 실발동 격리 **1개 티켓**, 분리된 다중 Git 저장소(`ads`·`payments`) 연동·차단 리허설 **3개 티켓**, 하네스 자체 개발 완료 티켓 **66건**(`.harness/tasks/archive/`, 중복 없음), 계약·장애 주입 자동화 테스트 **375건**(`tests/harness-cli/`).
  3. **결정론적 컨텍스트 예산 (`티켓당 64KB / 최대 12개 파일`):** 필수 안전 계약을 보존하면서 키워드 적합도(`relevance_score`) 기반으로 문서를 선별하고, 예산 초과 시 임의 절단 대신 즉시 중단.

```text
[1. 계획 (Plan)]           ➔  [2. 구현 (Implement)]  ➔  [3. 검증·검수 (Verify & Review)]  ➔  [4. 반영·이력 (Release & Audit)]
 1단계: 계획 (planner/architect) 3단계: 격리 실행         4단계: 검증 (verifier)               6단계: Git 반영 (release)
 2단계: 승인 (Human Gate)               (implementer)     5단계: 검수 (reviewer / 승인 패스)    7단계: 이력 (recorder/memory)
```

- **왜 만들었나:** 반복되는 맥락 전달·작업 추적·검증 근거 정리 → [실측 검증 요약](#실측-검증-요약-및-실제-실행-산출물) / [해결하는 문제](#해결하는-문제)
- **어떻게 통제하나:** 승인 패스 조건, 서킷 브레이커, 핵심 알고리즘 → [자율성 레벨과 승인 패스](#자율성-레벨과-승인-패스-bounded-autonomy) / [핵심 알고리즘](#핵심-알고리즘-경로-통제컨텍스트-선별에러-지문화)
- **어디까지 보장하나:** 코드로 강제하는 경계와 미지원 범위(런타임 샌드박스·RBAC 등) → [지원 범위와 한계](#지원-범위와-한계)

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

실제 프로젝트 적용 기록, 하네스 자체 개발 기록, 그리고 장애 주입 자동화 테스트 기록은 서로 다른 검증 근거이므로 아래와 같이 구분합니다([`PERSONAL_OPERATIONS_VALIDATION.md`](docs/project/PERSONAL_OPERATIONS_VALIDATION.md)).

| 검증 범주 | 표본 및 범위 (`n`) | 결과 | 중단(`BLOCKED`) 발동 건수 및 검증 내용 | 근거 위치 |
| :--- | :--- | :--- | :--- | :--- |
| **1. 외부 실프로젝트 적용** | **외부 저장소 1곳 (`ad-server`) / 3개 티켓** | **기능 병합 2건 / 서킷 브레이커 차단 1건** | **실발동 1건 (`APPROVAL_REQUIRED`, 가드 작동 확인용 의도적 유도).** `Ad-Server-Engine`(Java 21/Spring) 도메인·어트리뷰션 2건 단위 테스트(15/15) 통과 및 GitHub PR #1(`b687703`) 병합 + `scripts/deploy.sh` 수정 유도 티켓 1건 1차 시도에서 즉시 `BLOCKED` 격리 확인 | `.harness/local/requests/ad-domain-ml-upgrade.json`, `ad-server-deploy-guard-check.json` |
| **2. 다중 저장소 연동·차단 리허설** | **분리 저장소 2곳 (`ads`, `payments`) / 3개 티켓** | **정상 연쇄 2건 통과 / 실패 주입 1건 차단** | `ads` ➔ `payments` 선행 SHA 의존성 통과(2건) 및 `payments:fail` 서킷 브레이커(`BLOCKED`) 격리 확인(1건) | `.harness/local/simulations/`, [`OPERATIONS_REHEARSAL_VALIDATION.md`](docs/project/OPERATIONS_REHEARSAL_VALIDATION.md) |
| **3. 실계정 외부 연동 리허설** | **Jira 2건 · Confluence 2건** | **생성·조회·연결 확인** | **실발동 0건.** 개인 Atlassian 클라우드 계정 대상 실제 티켓/문서 게시 및 로컬 원장 대조 | [`PERSONAL_OPERATIONS_VALIDATION.md`](docs/project/PERSONAL_OPERATIONS_VALIDATION.md) |
| **4. 하네스 자체 개발 티켓** | **`harness-template` 66건** (아카이브) | **66 / 66 완료** | 하네스 코어·역할·평가지표·런타임 기능을 개발하며 수행한 단일 저장소 티켓 및 `verify --full` 통과 기록 | [`.harness/tasks/archive/`](.harness/tasks/archive/) |
| **5. 계약·장애 주입 자동화 테스트** | **375건** (42개 스위트) | **375 / 375 PASS** | 서킷 브레이커(`same-error-repeat`, `A → B → A` 진동 차단), 고위험 경로(`APPROVAL_REQUIRED`), `fast_track_allowed` 프로필 게이트, Lease 충돌, 응답 유실(`SENDING`) 차단 검증 | [`tests/harness-cli/`](tests/harness-cli/) |
| **6. 계획 품질 루브릭 평가** | **9개 고정 합성 사례** | **9 / 9 PASS** | 요구사항 분해, 선행 의존성, 범위 외 수정 억제, 필수 질문 누락 여부 채점 | [`planning-eval.js`](tools/harness-cli/planning-eval.js) |

<details>
<summary><b>실제 멀티 프로젝트 요청 JSON 발췌 및 상태 전이·검증 기록 보기 (클릭)</b></summary>

아래는 `ad-server`(`Ad-Server-Engine` 저장소) 고도화 요청(`.harness/local/requests/ad-domain-ml-upgrade.json`)에 기록된 실제 저위험 티켓 스펙 원문 발췌와 상태 전이 로그입니다.

```json
{
  "ticket_id": "event-attribution-last-click",
  "project_id": "ad-server",
  "ticket_kind": "development",
  "priority": "P1",
  "risk": "low",
  "risk_source": "explicit",
  "risk_reason": "기존 노출/클릭 수집 파이프라인을 변경하지 않고 독립된 도메인 서비스와 단위 테스트를 추가한다.",
  "labels": ["어트리뷰션", "이벤트정산"],
  "goal": "모듈 06에 클릭 후 7일 룩백 윈도우 기반 Last-Click 전환 기여 분석 서비스(AdAttributionService)와 ROAS 산출 로직 및 POJO 단위 테스트를 추가한다.",
  "scope": [
    "AdAttributionService(7일 룩백 윈도우, Last-Click 매칭, ROAS 계산)",
    "AdAttributionServiceTest 순수 POJO 단위 테스트 및 study/02,03,04,06 교재 업데이트"
  ],
  "exclusions": ["ad_event 테이블 DDL 변경 제외"],
  "retry_policy": {
    "max_attempts": 3,
    "stop_on_same_error": true
  },
  "verification": [".\\gradlew.bat test"]
}
```

```text
[Execution & State Transition Log Summary]
- Request ID       : ad-domain-ml-upgrade (plan status: APPROVED, fingerprint: 53774787...cdc966)
- Ticket ID        : event-attribution-last-click (project_id: ad-server, risk: low, max_attempts: 3)
- Path & Risk Check: PASS (no protected or high-risk segments such as migrations/infra/deploy touched)
- Verify Command   : .\gradlew.bat test --tests "com.example.adengine.attribution.*"
- Verify Result    : PASS (Exit Code 0, 해당 티켓 AdAttributionServiceTest 2건 통과 / 요청 전체 회귀 테스트 15/15 통과, 재시도 0회, 서킷 브레이커 발동 0건)
- State Transition : PREPARED ➔ RUNNING ➔ REVIEW_READY (검증 스냅샷) ➔ APPLIED (GitHub PR #1 병합, commit b687703)
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

> 하네스는 **1차 통제선**입니다. 작업 전 계약 검사와 승인·검증 증거 기록을 담당하고, 최종 물리적 강제는 원격 저장소의 Branch Protection·필수 CI·PR 리뷰가 맡는 **2중 방어 구조**입니다. 하네스를 우회한 직접 `git push`는 로컬에서 막을 수 없으므로, 서버 측 통제 없이 단독으로 쓰는 것은 권장하지 않습니다.

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

- **L4.5 (제한적 자동 수정, Bounded Auto-Fix):** 검증(`verify --full`) 실패 시 신규 파일 생성·삭제·이름 변경이나 보호 경로 침범 없이, **허용된 소스/테스트 루트(`src/`, `app/`, `lib/`, `test/`, `tests/`, `__tests__/`) 내 기존 파일**에서 패치 크기 예산(최대 5개 파일, 100KB) 이내로만 자동 수정을 재시도하는 기능입니다([`auto-fix-policy.md`](docs/design-docs/auto-fix-policy.md), [`autonomy-recover-command.js`](tools/harness-cli/autonomy-recover-command.js)).
- **L5 (승인 패스 자율 루프, Fast-Track Autonomy):** 사전 승인된 저위험 티켓의 범위(`owned_paths`)와 재시도 예산(기본 최대 3회 시도) 안에서 **구현 → 검증 → 재시도를 연속 수행**하고, 검증을 통과하면 중간 사람 검수 단계를 건너뛰어 최종 Git 반영 승인 단계로 직행하는 모드입니다(러너 전역 하드 캡은 테스트 픽스처·보일러플레이트 동반 수정을 고려해 최대 20개 파일 / 500KB로 두되, 실제 수정 범위는 티켓별 승인 경로로 좁게 제한됨; [`l5-autonomy-policy.md`](docs/design-docs/l5-autonomy-policy.md), [`agent-runner.js`](tools/harness-cli/agent-runner.js)).

### 1. 두 가지 실행 모드 비교 (Strict vs 승인 패스)

| 구분 | 표준 모드 (Strict Governance) | 승인 패스 모드 (Fast-Track: L4.5 / L5) |
| :--- | :--- | :--- |
| **적용 대상** | **고위험 작업:** 마이그레이션(`migrations`), 인프라/배포(`.github`, `infra`, `k8s`, `kubernetes`, `helm`, `terraform`, `deploy`, `scripts`), 의존성/환경 설정(`package.json`, `pom.xml`, `build.gradle`, `.env*`), 파일 삭제/이름 변경 | **저위험 / 명확한 스펙 작업:** 허용된 소스·테스트 경로 내의 단위 기능 구현, 버그 픽스, 테스트 코드 보강, 내부 리팩터링 |
| **설계상 수동 게이트** | **4단계 수동 확인:** 계획 승인 ➔ 구현 착수 확인 ➔ 결과 검수 수락 ➔ Git 릴리스 승인 | **2단계 수동 확인 (중간 2단계 패스):** **초기 계획 승인** 후 구현 착수와 결과 검수 수락을 건너뛰고 **최종 Git 릴리스 승인**으로 직행 (`4단계 → 2단계`) |
| **통제 경계** | 하네스 CLI 경로에서 미승인 상태 전이 및 지문 불일치 차단 | 허용 경로·검증 통과·예산 조건을 모두 충족할 때만 중간 검수 생략 허용 (이탈 시 즉시 `BLOCKED` 전환) |

### 2. 승인 패스 작동 조건과 서킷 브레이커 (Circuit Breaker)

- **승인 패스 4대 필수 조건:**
  1. **프로젝트 프로필 명시 허용 (`fast_track_allowed: true`, Fail-Closed 기본값 `false`):** `project onboard <id> --allow-fast-track --approve`로 사람이 테스트 신뢰도를 확인하고 승인 패스를 열어둔 저장소일 것. 실행 시작(`runner run --fast-track`) 시점과 릴리스 요청(`release request`) 시점 양쪽에서 모두 검사하여 미허용 프로젝트의 불필요한 모델 호출을 차단합니다([`project-onboarding.js`](tools/harness-cli/project-onboarding.js), [`agent-runner.js`](tools/harness-cli/agent-runner.js), [`control-plane-command.js`](tools/harness-cli/control-plane-command.js)).
  2. **승인된 경로 준수 (`owned_paths` 및 보호/고위험 경로 미침범):** 계획 단계에서 AI가 제안하고 사람이 승인(`approve`)해 확정한 파일 경로 내부만 수정할 것.
  3. **완전 검증 통과 (`verify --full`):** 프로젝트의 테스트·린트·빌드 명령이 Exit Code 0으로 통과할 것.
  4. **재시도 및 패치 예산 준수 (`Retry Budget`):** 티켓에 설정된 최대 시도 횟수(기본 3회) 및 패치 크기 한도 이내일 것.
- **비상 정지 서킷 브레이커 (`BLOCKED` 강등) 및 릴리스 요약 출력:**
  - 승인 패스 모드로 실행 중이더라도 **(1) 동일한 정규화 에러 지문이 재발(`same-error-repeat`, `A → B → A` 교차 반복 포함)**하거나, **(2) 고위험 경로 세그먼트·파일 삭제/모드 변경(`APPROVAL_REQUIRED`)이 감지**되면 남은 재시도 횟수를 소진하지 않고 **즉시 `BLOCKED` 상태로 전환**하여 사람을 호출합니다.
  - 최종 Git 반영 요청(`release request`) 시점에는 1회 승인의 판단 품질을 높이기 위해 `[RELEASE_SUMMARY] project:ticket | changed_files=N | owned_paths=PASS | verify=... | mode=fast-track|human-reviewed` 한 줄 요약을 출력합니다.

---

## 핵심 알고리즘 (경로 통제·컨텍스트 선별·에러 지문화)

컨트롤 플레인이 결정론적으로 동작하기 위해 다음 3가지 핵심 로직을 코드로 구현했습니다.

### 1. 경로 소유권 검증 및 고위험 경로 차단 ([`agent-runner.js`](tools/harness-cli/agent-runner.js), [`orchestration-command.js`](tools/harness-cli/orchestration-command.js), [`config.js`](tools/harness-cli/config.js))

1. **`owned_paths` 출처와 프리픽스 매칭 (`pathIsOwned`):** 작업 대상 경로(`scope` / `owned_paths`)는 계획 초안에서 AI가 제안하고 사람이 승인(`approve`)할 때 확정됩니다. 실행 시 수정된 파일 경로의 백슬래시(`\`)를 `/`로 정규화하고, 승인된 `owned_paths`와 일치하거나 하위 디렉터리 프리픽스(`owned.endsWith("/")`)에 속하는지 검사합니다.
2. **보호 경로 및 패치 형태 검사 (`validateRunnerPatch` / `validateAutoFixPatch`):**
   - `.git/`, `.harness/`, `observability/`, `node_modules/`, `.venv/`, `.env*` 접근, 상위 경로 이탈(`..`), Git 심볼릭 링크(`120000`), 바이너리 패치를 즉시 거부합니다.
   - L4.5 `auto-fix`에서는 `src/`, `app/`, `lib/`, `test/`, `tests/`, `__tests__/` 내부의 기존 파일만 수정하도록 강제(신규 파일 생성·삭제 차단, 최대 5개 파일 / 100KB)합니다.
3. **고위험 세그먼트 감시 (`DEFAULT_L5_HIGH_RISK_SEGMENTS`):** 패치 경로에 `.github`, `deploy`, `deployment`, `helm`, `infra`, `k8s`, `kubernetes`, `migrations`, `scripts`, `terraform` 세그먼트나 의존성 설정 파일(`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)이 포함되면 재시도 루프를 즉시 멈추고 `APPROVAL_REQUIRED`로 분류합니다.

### 2. 서킷 브레이커의 '동일 에러 재발(`same-error-repeat`)' 판정 ([`agent-runner.js#L31-L39`](tools/harness-cli/agent-runner.js))

실행 실패 시 에러 출력에 섞이는 **ISO 타임스탬프(`<ts>`), 임시/worktree 및 빌드 리포트·`.gradle` 캐시 경로(`<path>`), 실행 소요 시간(`<duration>`)**과 공백을 정규화한 뒤 SHA-256 해시를 계산합니다.

```javascript
function fingerprintError(error) {
  const normalized = String(error?.message || error || "unknown error")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?/g, "<ts>")
    .replace(/(?:[A-Za-z]:)?[\\/][\w.\-\\/]*(?:tmp|temp|worktrees|harness-runner-|\.gradle|build[\\/]reports)[\w.\-\\/]*/gi, "<path>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b/gi, "<duration>")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
```

- 매 시도 실패 시 `error_fingerprint`를 이력에 기록하고, 해당 티켓의 현재 실행 패스 내 **이전 실패 시도 전체의 지문 집합(`seenErrorFingerprints` Set)**과 대조합니다. 따라서 연속 반복(`A → A`)뿐 아니라 `A → B → A` 형태의 교차 진동 루프가 발생해도 즉시 루프를 종료하고 `BLOCKED` 상태로 고정하며, 사람이 원인을 수정한 뒤 티켓을 재개(`PREPARED`)하면 새 실행 패스에서는 Set이 초기화됩니다.

### 3. 컨텍스트 선별·압축 및 모델 티어 라우팅 ([`project-context.js`](tools/harness-cli/project-context.js), [`model-router.js`](tools/harness-cli/model-router.js))

별도의 벡터 DB 없이 로컬 파일시스템에서 즉시 재현 가능하도록 **우선순위 트리(P0~P9) + 키워드 토큰 적합도(`relevance_score`)** 알고리즘을 사용합니다.

1. **우선순위 및 키워드 점수 결합 (`selectTicketFiles`):**
   - 문서를 `instructions(P0) → plan(P1) → context-file(P2) → active-task(P3) → design/ADR(P4~5) → working/semantic/procedural/episodic 메모리(P6~9)` 순으로 분류합니다.
   - 티켓의 `title`, `goal`, `scope`, `owned_paths`에서 추출한 3글자 이상 키워드 토큰이 후보 문서의 경로·본문에 매칭되는 횟수로 `relevance_score`를 계산해, 동일 계층 내에서 관련도가 높은 문서부터 **64KB(최대 12개 파일) 예산** 안에 채웁니다.
   - 필수 안전 계약(`AGENTS.md`, `safety-contract.md`, `PLANS.md`)은 `required: true`로 고정하며, 필수 문서만으로 예산이 초과되면 문서를 임의로 자르지 않고 에러로 중단합니다.
2. **비신뢰 입력 격리와 패치 단계 2중 차단 (`detectContextRisks` + `validateRunnerPatch`):** 외부 프로젝트 문서와 Jira/Confluence 본문은 `untrusted-project-input`으로 태깅하고 시스템 지시 무시(`policy-override`)·환경변수 유출(`secret-access`)·파괴적 명령 유도(`tool-escalation`) 패턴을 1차 스캔합니다. 설령 모델이 우회 인젝션에 속아 악성 응답을 생성하더라도, 실제 파일·Git 반영은 패치 적용 단계(`validateRunnerPatch`)의 보호 경로 및 `owned_paths` 검사에서 차단합니다.
3. **실패 이력 연동 모델 라우팅 (`resolveModelTier`):** 작업 역할(`architect / implementer / reviewer`), 위험도(`low / medium / high`), 중요도(`P0~P3`), 범위 크기(`scopeCount`), 그리고 **재시도 횟수(`attempt >= 2`) 및 수선 필요 여부(`repairRequired`)**를 조합해 `fast / standard / strong` 티어를 결정론적으로 선택합니다. 1차 시도 실패 후 재시도 시 상위 모델 티어로 자동 승격하며, 고위험 티켓에 `fast` 티어를 강제 지정하면 거부합니다.

---

## 실제 사용 흐름

> **사람은 대화창에서 '1번(자연어 업무 지시)'과 '3번(재시도·승인 패스 조건 컨펌)'만 말로 수행합니다.**  
> JSON 스펙 작성과 `capture ➔ draft ➔ approve --prepare` 등의 CLI 상태 전이 명령은 사람이 터미널에 직접 타이핑하는 것이 아니라, [`AGENTS.md`](AGENTS.md) 규칙에 따라 **AI 에이전트가 백그라운드에서 자동 오케스트레이션**합니다.

사용자가 대화창에 오늘 처리할 복수의 업무를 자연어로 한 번에 던지면, AI는 바로 코드를 수정하지 않고 티켓 후보와 **위험도(`risk`), 재시도 횟수(`max_attempts`), 승인 패스(Fast-Track) 가능 여부**를 먼저 브리핑합니다.

1. **사용자 요청 (자연어 일괄 지시):** *"광고 어트리뷰션(Last-Click) 도메인 및 단위 테스트를 추가하고, 배포 스크립트(`scripts/deploy.sh`)의 헬스체크 옵션도 같이 수정해줘."*
2. **AI 티켓 후보 브리핑 (경로 기반 위험도 분리 시연):**
   - `event-attribution-last-click` (`project_id: ad-server`, `risk: low`, `max_attempts: 3`, 대상 경로 `src/main/...`, `src/test/...` ➔ **승인 패스(Fast-Track) 권장**)
   - `deploy-script-check` (`project_id: ad-server`, `risk: high`, `max_attempts: 2`, 대상 경로 `scripts/deploy.sh` ➔ **단순 옵션 수정이라도 고위험 세그먼트(`scripts/`, `deploy`)에 해당하므로 Fast-Track 불가 및 Strict 수동 승인 강제**)
3. **사람의 실행 조건 조정 및 컨펌:** *"어트리뷰션 테스트 티켓은 승인 패스로 바로 진행하고, 배포 스크립트 티켓은 재시도 1회로 줄여서 내 검수 받고 진행해줘."*
4. **AI 백그라운드 통제 실행:** AI가 컨펌받은 재시도 예산과 승인 모드를 계획 JSON에 동결하고 `request approve <id> --prepare`로 모든 티켓의 격리 worktree(`.worktrees/`)를 일괄 생성한 뒤, 구현 및 `verify --full` 검증을 수행합니다(만약 Fast-Track 티켓 실행 도중 `scripts/`나 `migrations/` 경로를 건드리면 즉시 `APPROVAL_REQUIRED`로 강등되어 멈춥니다).

### 계획에서 실행까지의 상태 전이

```text
입력 스냅샷 → 상세 초안 DRAFT → 계획 검수/수정 → APPROVED (1차 수동 게이트: 계획 승인)
                                               |
                                  실행 준비 PREPARED (중간 착수 확인 생략)
                                               |
                                      RUNNING + 검증 (verify --full)
                                       /          \
                                  BLOCKED      REVIEW_READY ──[승인 패스 (Fast-Track: 중간 검수 생략)]──┐
                                                  |                                                  |
                                       사람의 결과 수락 (Strict 수동 검수)                             |
                                                  |                                                  ▼
                                                  └──────> 별도 Git 릴리스 승인 (2차 수동 게이트) <───┘
                                                                          |
                                                                       APPLYING
                                                                          |
                                                                       APPLIED
```

> 단계를 잘게 나눈 것은 **감사 단위와 지문 동결 단위**를 분리하기 위해서입니다. 일상 사용은 AI가 이 명령들을 오케스트레이션하고, 사람은 직접 개입·디버깅할 때만 개별 명령을 사용합니다.

<details>
<summary><b>백그라운드 CLI 상태 전이 및 컨텍스트/프로바이더 명령어 보기 (클릭)</b></summary>

```bash
# 1. AI가 백그라운드에서 수행하는 계획 캡처·초안·검수·일괄 승인 및 격리 실행 준비
npm run harness -- request capture work-01 --input-file .harness/local/input.json
npm run harness -- request draft work-01 --output-file .harness/local/output.json
npm run harness -- request planning work-01
npm run harness -- request planning-review work-01 --review-file .harness/local/review.json
npm run harness -- request approve work-01 --prepare

# (개별 단계 디버깅 시: request approve -> request ready -> execution prepare 분리 호출 가능)
```

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
| 계획·계획 근거 | 프로젝트, 티켓, 범위(`scope`/`owned_paths`), 위험도, 검증 명령, 의존관계와 출처 근거 | 재검토/재승인 필요 |
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

실패 시 무조건 재시도하거나 강제 리셋으로 작업 트리를 덮어쓰지 않고, **Why + Safe Next Action**으로 원인 범주와 첫 확인 명령을 안내합니다.

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
| :--- | :--- | --- |
| CLI·설정·검증 | [index.js](tools/harness-cli/index.js), [config.js](tools/harness-cli/config.js), [verify-command.js](tools/harness-cli/verify-command.js), [single-repo-task-command.js](tools/harness-cli/single-repo-task-command.js) | 엔트리포인트(`index.js`)는 라우팅을 담당하고 명령군별 모듈 분리 |
| 계획·입력 근거 | [planning-contract.js](tools/harness-cli/planning-contract.js), [planning-command.js](tools/harness-cli/planning-command.js), [request-plan.js](tools/harness-cli/request-plan.js) | 구조 검증과 의미 검수 분리 |
| 컨텍스트 선별 | [agent-context.js](tools/harness-cli/agent-context.js), [project-context.js](tools/harness-cli/project-context.js) | P0~P9 우선순위 + 키워드 점수로 64KB 예산 내 압축, 필수 안전 계약 고정 |
| 실행·서킷 브레이커 | [agent-runner.js](tools/harness-cli/agent-runner.js), [project-execution.js](tools/harness-cli/project-execution.js), [autonomy-recover-command.js](tools/harness-cli/autonomy-recover-command.js) | Lease·시도 선기록·에러 SHA-256 지문 비교(`fingerprintError`)·소유 경로 검사 |
| 승인·Git 반영 | [control-plane-command.js](tools/harness-cli/control-plane-command.js), [governance-ledger.js](tools/harness-cli/governance-ledger.js) | 사람 검수와 단발 Git 승인 분리 |
| 영속성 | [control-plane-state.js](tools/harness-cli/control-plane-state.js) | 원자적 파일 저장과 로컬 잠금 |
| 게시·알림 | [operations-publish.js](tools/harness-cli/operations-publish.js), [runner-notifications.js](tools/harness-cli/runner-notifications.js) | 개발 결과와 외부 전달 실패 분리 |
| 이력·복구 안내 | [work-history.js](tools/harness-cli/work-history.js), [safe-next-action.js](tools/harness-cli/safe-next-action.js) | 조회 감사는 남기고 복구보다 상태 확인 우선 |
| 모델·평가 | [model-router.js](tools/harness-cli/model-router.js), [planning-eval.js](tools/harness-cli/planning-eval.js), [skill-eval.js](tools/harness-cli/skill-eval.js) | 위험도·재시도 기반 티어 라우팅과 루브릭/Oracle 평가 분리 |

---

## 지원 범위와 한계

**구현된 범위:** 개인 개발자의 로컬 다중 저장소 등록·온보딩, 상세 계획/검수 감사 기록, 위험도 기반 실행(Strict 수동 검수 및 L4.5/L5 조건부 승인 패스)·Git 반영 준비(브랜치/PR), 이력 추적 및 선택형 외부 연동(OpenAI/Anthropic/Gemini API, Jira/Confluence, Slack/Telegram, 암호화 백업). **운영 배포(CD)는 책임 범위 밖입니다.**

이 아키텍처가 다루는 문제(계획-실행 불일치 탐지, 소유 경로 격리, 실패 지점 재개, 감사 원장)는 팀 단위 AI 거버넌스로 일반화 가능하지만, **현재 구현의 보장 범위와 한계는 다음과 같이 명확히 구분됩니다.**

- **다중 사용자 기능 미포함 (개인용 로컬 Control Plane):** 중앙 DB나 원격 인증 서버 없이 로컬 파일 잠금 기반으로 동작합니다. 다수의 개발자가 동시 접속하는 사내 플랫폼(IDP)으로 확장하려면 **사용자별 RBAC(역할 기반 접근 제어), 원격 중앙 잠금 서버(Distributed Lock), 조직 단위 SSO/서명 검증**이 추가로 필요합니다.
- **통제 경계 (Managed CLI vs OS Sandbox) 및 런타임 코드 실행:** 하네스 CLI(`runner`, `execution`, `release`)를 거치는 관리형 경로에서는 미승인 변경과 소유 경로 이탈을 차단하지만, OS 커널/컨테이너 수준의 보안 샌드박스가 아닙니다. 따라서 사용자가 터미널에서 직접 실행하는 raw `git commit/push`를 막지 못하며, **패치 경로 검사는 수정되는 파일의 위치만 통제할 뿐 `verify --full` 실행 시 허용된 경로 내의 테스트·빌드 코드가 로컬 권한으로 수행하는 런타임 행위(파일 읽기, 외부 네트워크 호출 등)까지 차단하지는 못합니다.**
- **승인자 신원 및 로컬 원장 위협 모델:** Fingerprint는 SHA-256 해시이지 비밀키 기반 HMAC이나 전자서명이 아니므로, 로컬 파일 쓰기 권한이 있는 주체가 원장과 지문을 함께 재작성하는 행위는 탐지하지 못합니다. 팀 감사 근거로 쓰려면 작성자 인증과 서명, 중앙 저장이 필요하며 현재는 미구현입니다.
- **Fast-Track 안전성과 테스트 품질 의존성:** 프로젝트 온보딩 시 기본값을 `fast_track_allowed: false`(Fail-Closed)로 두고 사람이 명시적으로 `--allow-fast-track`을 승인한 프로젝트의 `risk: low` 티켓만 중간 검수 생략을 허용합니다. 다만 언어별 테스트 커버리지 수치 강제는 없으므로, 승인 패스의 실질 안전은 대상 프로젝트의 테스트 품질에 의존합니다.
- **에러 지문(`fingerprintError`) 정규화 범위:** 서킷 브레이커는 ISO 타임스탬프, `ms/s` 소요 시간, 임시/worktree 경로를 정규화하고 이전 시도 Set 전체와 비교해 `A → B → A` 반복까지 차단하지만, 프레임워크 고유의 임의 메모리 주소나 동적 포트 번호가 에러 메시지에 매번 다르게 찍히는 경우까지는 정규화하지 못합니다.
- **`owned_paths` 출처 및 컨텍스트 선별의 한계:** `owned_paths`와 작업 범위는 AI가 초안에서 제안하고 사람이 승인 시 확정합니다. 또한 컨텍스트 선별(`selectTicketFiles`)은 코드베이스 탐색이나 AST 구문 파싱, 임베딩 벡터 검색이 아니라 **등록된 문서 내 키워드 토큰 출현 빈도 합산(`relevance_score`)**으로 동작하므로 분량이 긴 문서에 점수가 유리할 수 있습니다. 계획 평가(`planning-eval.js`) 역시 9개 고정 합성 사례와 인간 루브릭을 결합한 회귀 검증용이며 대규모 온라인 LLM-as-a-Judge 파이프라인을 대체하지 않습니다.
- **측정 근거의 분리:** 설계상 수동 승인 게이트 수 축소(`4단계 → 2단계`)나 자동화 테스트 통과(`375건`)는 아키텍처 및 계약 검증 지표입니다. 장기 실사용에서의 실제 업무 시간·토큰·비용 절감률은 [실사용 운영 지표 정의 및 비교 측정 규격](docs/project/PERSONAL_OPERATIONS_VALIDATION.md#실사용-운영-지표-정의-metric-definitions-및-비교-측정-규격)을 기준으로 프로젝트별 운영 로그에서 별도로 측정해야 합니다.
- **다음 과제:** 프로젝트 프로필에 최소 테스트 커버리지 기준 선택형 연동, 승인 기록에 작성자 전자서명 도입, 외부 실프로젝트 누적 티켓 20건 이상 확대 및 하네스 미사용 대비 리드타임 실측 비교.

---

## 상세 문서

- [전체 CLI 가이드](docs/HARNESS_GUIDE.md), [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)
- [계획 품질 계약](docs/PLANNING_QUALITY_GUIDE.md), [기획·설계 티켓](docs/PLANNING_TICKETS.md)
- [Atlassian 설정](docs/ATLASSIAN_MCP.md), [운영 상태와 비용](docs/OPERATIONS_STATUS.md)
- [티켓 컨텍스트 참조](docs/TICKET_CONTEXT_REFERENCES.md), [백업과 복원](docs/STATE_BACKUP.md)
- [운영 근거 보고서](docs/OPERATIONS_EVIDENCE_GUIDE.md), [운영 검증 기록](docs/project/PERSONAL_OPERATIONS_VALIDATION.md)
- [필수 안전 계약](docs/design-docs/safety-contract.md), [L4.5 자동 수정 정책](docs/design-docs/auto-fix-policy.md), [L5 자율 실행 정책](docs/design-docs/l5-autonomy-policy.md), [릴리스 정책](docs/RELEASE_SAFETY.md), [에이전트 진입 규칙](AGENTS.md)

전체 명령은 `npm run harness -- help --all`에서 확인할 수 있습니다.
