# Harness Engineering Template — 종합 가이드

> AI 에이전트와 인간 개발자가 함께 일하기 위한 범용 개발 OS 사용 설명서

---

## 📐 전체 구조 한눈에 보기

```
scratch/
├── AGENTS.md                         ← 에이전트 헌법 (목차 역할, 40줄)
├── README.md                         ← 인간용 요약
├── docker-compose.yml                ← 로컬 인프라 (MySQL/Redis/Kafka/ES)
├── package.json                      ← Husky + commitlint
├── .commitlintrc.json                ← 커밋 메시지 형식 규칙
├── .gitignore
├── .env.template                     ← 환경 변수 템플릿
│
├── docs/
│   ├── project/
│   │   └── PLANS.md                 ← 🔑 사용자가 채우는 프로젝트 목표
│   ├── design-docs/
│   │   ├── core-beliefs.md          ← 코딩 규칙, 아키텍처 원칙
│   │   └── tech-stack.md            ← 기술 스택 기본값
│   ├── skills/
│   │   ├── code-review.md           ← 코드 리뷰 스킬
│   │   ├── git-workflow.md          ← Git 컨벤션 스킬
│   │   └── harness-diagnostics.md  ← 하네스 자가진단 스킬
│   └── adr/
│       └── ADR-000-template.md      ← 아키텍처 결정 기록 템플릿
│
├── scripts/
│   ├── start-task.sh                ← 태스크 시작 (워크트리 생성)
│   ├── create-ticket.sh             ← backlog 티켓 생성
│   ├── create-ticket.ps1            ← Windows/PowerShell용 backlog 티켓 생성
│   ├── start-ticket.sh              ← backlog 티켓을 active로 승격
│   ├── start-ticket.ps1             ← Windows/PowerShell용 active 승격
│   ├── verify-task.sh               ← 검증 (테스트+빌드)
│   ├── complete-task.sh             ← 완료 및 GC
│   ├── complete-task.ps1            ← Windows/PowerShell용 완료 및 GC
│   ├── scan-drift.sh                ← Drift 자동 감지
│   ├── run-agent.sh                 ← AI API 직접 호출
│   └── utils.sh                     ← Slack 알림 공통 함수
│
├── prompts/
│   └── system/roles/                ← Planner/Reviewer 등 역할 프롬프트
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   ← PR 자동 테스트 (Java/Node 감지)
│   │   └── security.yml             ← 보안 취약점 스캔
│   ├── dependabot.yml               ← 의존성 자동 업데이트
│   └── pull_request_template.md     ← PR 양식
│
├── .husky/
│   ├── commit-msg                   ← 커밋 메시지 형식 강제
│   └── pre-commit                   ← console.log 등 금지 패턴 차단
│
└── .harness/
    ├── tasks/
    │   ├── backlog/                 ← 아직 시작하지 않은 티켓
    │   ├── active/                  ← 진행 중인 태스크 EXEC_PLAN
    │   └── archive/                 ← 완료된 태스크 기록
    └── logs/                        ← 에이전트 실행 로그
```

---

## 🚀 새 프로젝트 시작 (5분 셋업)

### Step 1. 템플릿으로 새 레포 생성
GitHub에서 **"Use this template"** → 새 레포 생성 → 클론

### Step 2. 환경 변수 설정
```bash
npm run harness -- check
# .env.local이 없으면 자동 생성됩니다.
# .env.local을 열고 아래 항목 입력:
# - SLACK_WEBHOOK_URL (작업 알림)
# - OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (AI 사용 시)
```

Windows PowerShell에서 `npm`이 실행 정책 오류로 막히면 아래처럼 `npm.cmd`를 사용합니다.

```powershell
npm.cmd run harness -- check
```

PowerShell wrapper를 직접 실행할 때 권한 오류가 나면 현재 프로세스에서만 우회합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-environment.ps1
```

### Step 3. 의존성 설치 (Git Hooks 활성화)
```bash
npm install
```

### Step 3-1. 환경 사전 점검
작업 장소나 OS를 바꿨다면 먼저 실행합니다.

```bash
npm run harness -- check
```

### Step 4. PLANS.md 작성 ← **가장 중요**
`docs/project/PLANS.md`를 열고 작성:
```markdown
## 서비스 개요
내가 만들 서비스 설명

## 기술 스택
- 백엔드: Java 21 + Spring Boot 3.x
- DB: MySQL 8.x + Redis

## 로드맵
- Task 1: 사용자 인증 API
- Task 2: 광고 CRUD
```

### Step 5. 첫 티켓 생성 및 시작
```bash
npm run harness -- create-ticket user-auth feat --goal "JWT 기반 사용자 인증을 구현한다"
npm run harness -- start-ticket user-auth
# 여기서 구현 작업

# 개발 도중 변경한 파일 기준의 빠른 부분 검증 (성공해도 complete-task는 불가)
npm run harness -- verify --quick

# 최종 완료를 위한 전체 검증 (기본값은 --full)
npm run harness -- verify

# 만약 검증 중 생성된 불필요한 부산물(Untracked 파일)을 정리하고 싶다면:
npm run harness -- cleanup --dry-run
npm run harness -- cleanup --approve <manifest-id>

git add -A
git commit -m "feat(auth): JWT 기반 사용자 인증 구현"
# 원격 저장소가 설정된 경우에만: git push
npm run harness -- complete-task user-auth
git add -A
git commit -m "chore(harness): user-auth 완료 기록"
# 원격 저장소가 설정된 경우에만: git push
```

`complete-task`는 active 티켓을 archive로 이동하고 완료 메타데이터를 기록하므로,
명령 실행 후 생긴 변경은 별도 마감 커밋으로 저장합니다.
`complete-task`와 L5 자율 실행 완료는 반드시 `verify --full`이 성공한 지문 상태에서만 허용됩니다.
Quick과 Full 결과는 각각 `last_quick`, `last_full`로 기록되며 Quick 실행은 유효한 Full 기록을 덮어쓰지 않습니다.
Cleanup은 검증 시작 전에 없었다가 검증 중 새로 생성된 untracked 일반 파일만 후보로 기록합니다.
`verify.quick`이 비어 있으면 Node 프로젝트의 `test`/`lint` 스크립트 또는 Gradle 테스트를 변경 파일 확장자에 맞춰 자동 선택합니다.
Full 검증에서 테스트·커버리지·빌드 또는 명시적 Full 명령이 하나도 실행되지 않으면 `inconclusive`로 차단됩니다.

하네스 코어 자체 검증:

```bash
npm test
npm run test:soak
```

GitHub Actions는 Ubuntu, macOS, Windows에서 단위 테스트와 각 OS용 스모크 테스트를 반복합니다.

기존 Bash/PowerShell wrapper도 호환용으로 유지됩니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/complete-task.ps1 user-auth -Force
```

PowerShell만 사용할 수 있다면 티켓 생성/시작도 아래처럼 진행할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-ticket.ps1 user-auth feat -Goal "JWT 기반 사용자 인증을 구현한다"
powershell -ExecutionPolicy Bypass -File scripts/start-ticket.ps1 user-auth
```

자세한 OS/CLI/API-key 지원 범위는 `docs/design-docs/execution-modes.md`를 기준으로 확인하세요.
현재 기준은 macOS/Linux/WSL/Git Bash가 Bash 스크립트의 1급 실행 환경이고, Windows PowerShell은 티켓 생성/시작/완료를 네이티브로 지원합니다.

---

## 🤖 AI 에이전트 활용 방법

### 방법 1: 툴 방식 (Antigravity, Cursor, Claude Code 등)
별도 설정 없이 AI가 `AGENTS.md`를 읽고 규칙대로 작업.

### 방법 2: API 직접 호출 (토큰 방식)

```bash
# .env.local에 API 키 설정 후
HARNESS_AGENT_MODE=api

# 일반 코드 생성 (저렴한 모델 자동 선택)
npm run harness -- run-agent --type code "UserRepository CRUD 구현해줘"

# 역할을 명시한 호출
npm run harness -- run-agent --role planner "PLANS.md 기준으로 첫 태스크를 쪼개줘"
npm run harness -- run-agent --role reviewer --type review "이번 diff를 리뷰해줘"

# 아키텍처 설계 (강력한 모델 자동 선택)
npm run harness -- run-agent --type architect "Redis + MySQL 하이브리드 캐싱 설계해줘"

# 코드 리뷰
npm run harness -- run-agent --type review "이번 PR 코드 리뷰해줘"

# 문서 작성
npm run harness -- run-agent --type docs "API 문서 작성해줘"
```

**모델 자동 라우팅:**

| Task Type | OpenAI | Anthropic | Gemini |
|-----------|--------|-----------|--------|
| `code` / `docs` | gpt-5-mini | claude-haiku-4-5 | gemini-3-flash |
| `review` / 기본 | gpt-5.2 | claude-sonnet-4-6 | gemini-3-flash |
| `architect` | gpt-5.2 | claude-opus-4-7 | gemini-3.1-pro |

**Provider 선택:**
```bash
AI_PROVIDER=anthropic bash scripts/run-agent.sh --type architect "설계해줘"
```

**역할 기반 실행:**

| Role | 용도 |
|------|------|
| `orchestrator` | 선택형 멀티에이전트 계획 고정, 상태·승인·통합 게이트 관리 |
| `planner` | 목표/범위/완료 기준 정리 |
| `architect` | 설계/트레이드오프/승인 필요 결정 검토 |
| `implementer` | 최소 범위 코드 구현 |
| `reviewer` | 버그/회귀/테스트 누락 리뷰 |
| `verifier` | 테스트/빌드/CI/보안 결과 확인 |
| `recorder` | 작업 결과와 로그 정리 |
| `memory` | memory 레이어 갱신 판단 |
| `release` | 커밋/PR/완료 처리 |

---

## ⚙️ 자동화 메커니즘

### L4.5 제한적 자동 수정

API 모드에서 명시적으로 활성화하면 검증 실패 시 저위험 소스/테스트 패치를 한 번 생성해 적용하고 전체 검증을 다시 실행합니다.

```bash
npm run harness -- verify --auto-fix
```

- 기본 비활성화: `HARNESS_AUTO_FIX=false`
- 기존 소스/테스트 파일만 수정
- 최대 5개 파일, 100KB
- 설정, 의존성, CI, 스크립트, 인프라, migration, 비밀값 차단
- 재검증 실패 시 자동 원복
- 커밋, 푸시, 병합은 사람의 검토 후 수행

상세 정책: [`docs/design-docs/auto-fix-policy.md`](design-docs/auto-fix-policy.md)

### L5 Experimental 자율 실행

L5는 사용자가 명시적으로 `HARNESS_AUTONOMY_LEVEL=5`를 설정해야 실행됩니다.

```bash
npm run harness -- autonomy
npm run harness -- autonomy --status
```

대화형 모드는 현재 AI 세션이 체크포인트를 따라 진행하고, API 모드는 clean worktree에서
티켓 선택, 구현 패치, 검증, 제한적 연속 실행을 수행합니다. CI, 의존성, 인프라,
migration 같은 고위험 변경은 자동 적용하지 않고 승인을 기다립니다.

상세 정책: [`docs/design-docs/l5-autonomy-policy.md`](design-docs/l5-autonomy-policy.md)

세션이나 API 호출이 중단됐다면 변경을 지우지 말고 먼저 복구 진단을 실행합니다.

```bash
npm run harness -- recover
```

현재 체크포인트, active 티켓, Git 변경, 마지막 verify 지문을 대조해 안전한 다음 행동을 JSON으로 출력합니다.

### 선택형 멀티에이전트 orchestration

멀티에이전트는 기본 비활성화이며 기존 단일 에이전트 흐름을 바꾸지 않습니다. 프로젝트 설정에서 활성화한 뒤, 역할을 병렬 또는 격리 실행하려는 티켓에서만 명시적으로 시작합니다.

```bash
# adapter와 병렬 capability 확인
npm run harness -- orchestrate --capabilities

# 환경 capability에 따라 native, API, sequential fallback 선택
npm run harness -- orchestrate optional-multi-agent --mode auto --max-workers 2

# 상태 확인, 중단 후 재개, 승인
npm run harness -- orchestrate --status <run-id>
npm run harness -- orchestrate --resume <run-id>
npm run harness -- orchestrate --approve <run-id>

# 대화형 host가 planner/architect artifact를 기록한 뒤 단일 writer 구현
npm run harness -- orchestrate --record <run-id> --role planner --artifact <file>
npm run harness -- orchestrate --record <run-id> --role architect --artifact <file>
npm run harness -- orchestrate --begin-review <run-id>

# reviewer/verifier 기록 후 전체 검증과 마감
npm run harness -- orchestrate --record <run-id> --role reviewer --artifact <file>
npm run harness -- orchestrate --record <run-id> --role verifier --artifact <file>
npm run harness -- verify --full --task <ticket>
npm run harness -- orchestrate --finish <run-id>
```

실행 방식:

| Mode | 동작 |
|------|------|
| Interactive Native | Codex 같은 host의 native adapter가 하위 에이전트 생성·메시지·대기·취소를 담당합니다. |
| API Managed | `HARNESS_AGENT_MODE=api`에서 역할별 provider 요청을 실행하고 공통 artifact로 정규화합니다. |
| Sequential Fallback | 하위 에이전트나 병렬 capability가 없으면 역할 요청을 하나씩 만들고, 호스트가 artifact를 기록한 뒤 다음 역할로 진행합니다. |

Phase 1은 Planner/Architect와 Reviewer/Verifier 같은 읽기 중심 역할만 병렬화하고, workspace를 수정하는 Implementer는 하나로 제한합니다.

Phase 2 multi-writer는 별도 opt-in입니다. 각 worker가 겹치지 않는 `owned_paths`, 동일한 base SHA, `.worktrees/orchestrate/<run-id>/` 아래의 격리 branch/worktree를 가져야 합니다. manifest, lockfile, DB migration, CI, scripts, 인프라, 보안 정책은 병렬 writer에 배정하지 않습니다.

```bash
npm run harness -- orchestrate --prepare-workers <run-id> --plan <worker-plan.json>
# worker worktree에서 commit 후 verify --full을 실행한 다음 기록
npm run harness -- orchestrate --record-worker <run-id> --worker <id> --commit <sha>
npm run harness -- orchestrate --integrate <run-id> --approve-risk
npm run harness -- orchestrate --begin-review <run-id>
npm run harness -- orchestrate --promote <run-id> --approve-risk
```

다음 항목은 자동 통합하지 않고 사용자 승인을 기다립니다.

- DB, dependency, CI/build, scripts, 인프라, 인증/권한/보안 변경
- 파일 삭제 또는 이름 변경
- 비용이 발생하는 외부 API 또는 secret 접근
- worker 결과 통합, commit, push, PR merge
- stale base, 소유 경로 이탈, 검증 실패, 통합 충돌

승인된 결과도 integration branch에서 다시 검증해야 합니다.

```bash
npm run harness -- verify --full
npm run harness -- complete-task <ticket>
```

worker별 검증이나 `verify --quick`은 최종 완료 조건이 아닙니다. 현재 통합 콘텐츠와 일치하는 `verify --full` 성공 지문이 있어야 `complete-task`가 허용됩니다.

### Git Hooks (커밋 시 자동 실행)
| Hook | 검사 항목 |
|------|-----------|
| `commit-msg` | 커밋 메시지 형식 (`feat(scope): 설명`) |
| `pre-commit` | `console.log` / `System.out.println` 코드 |

### GitHub Actions (PR 시 자동 실행)
| 워크플로우 | 실행 시점 | 내용 |
|------------|-----------|------|
| `ci.yml` | push / PR | 테스트 + 빌드 (Java/Node 자동 감지) |
| `security.yml` | push / PR / 주간 | 취약점 스캔 + 시크릿 탐지 |

### Dependabot (자동 PR 생성)
매주 월요일, npm과 GitHub Actions 의존성 업데이트 PR 자동 생성.

---

## 📋 스킬 사용법

스킬은 에이전트가 특정 작업을 수행할 때 읽는 절차 파일입니다.

| 스킬 파일 | 용도 | 사용 시점 |
|-----------|------|-----------|
| `docs/skills/code-review.md` | 코드 리뷰 체크리스트 | PR 리뷰 시 |
| `docs/skills/git-workflow.md` | 커밋/PR 규칙 | 커밋 작성 시 |
| `docs/skills/harness-diagnostics.md` | 하네스 품질 자가진단 | 분기별 점검 |

**에이전트에게 스킬 사용 지시 방법:**
```
"docs/skills/harness-diagnostics.md 스킬로 이 프로젝트 진단해줘"
```

---

## 🔍 Drift 점검 (주기적으로 실행)

```bash
bash scripts/scan-drift.sh
```

감지 항목:
- 14일 이상 방치된 active 태스크
- 로그 파일 100개 초과 (정리 필요)
- 코드에서 사용 중인 환경 변수가 `.env.template`에 없는 경우
- archive 50개 초과 (분기별 정리 권장)

---

## 🗂️ 아키텍처 결정 기록 (ADR)

중요한 기술 결정을 내릴 때마다:
```bash
cp docs/adr/ADR-000-template.md docs/adr/ADR-001-redis-caching.md
# 파일 열고 작성
git add -A
git commit -m "docs(adr): Redis 캐싱 전략 결정 기록"
```

---

## 📊 하네스 성숙도 자가진단

```
에이전트에게: "docs/skills/harness-diagnostics.md 스킬로 현재 프로젝트를 Audit 모드로 진단해줘"
```

| 점수 | 레벨 | 의미 |
|------|------|------|
| 0-19 | L1: None | 에이전트 협업 미고려 |
| 20-39 | L2: Basic | 최소한의 문서만 |
| 40-59 | L3: Structured | 체계적 구조, 부분 자동화 |
| 60-79 | L4: Optimized | 높은 자동화, 낮은 drift |
| 80-100 | L5: Autonomous | 에이전트 독립 기여 가능 |

**이 템플릿으로 시작 시 초기 점수: 약 70점 (L4)**

---

## ❓ FAQ

**Q. PLANS.md를 안 쓰면?**
에이전트가 "프로젝트 목표를 모르는 상태"로 일합니다. 반드시 작성하세요.

**Q. 스크립트가 Windows에서 안 돌아요.**
우선 `npm run harness -- ...`를 사용하세요. Bash/PowerShell 스크립트는 호환용 wrapper입니다.

**Q. PowerShell에서 `npm` 또는 `.ps1` 실행이 UnauthorizedAccess로 막혀요.**
`npm.cmd run harness -- check`를 먼저 사용하세요. `.ps1` wrapper를 직접 실행해야 한다면 `powershell -ExecutionPolicy Bypass -File scripts/check-environment.ps1`처럼 현재 실행에만 우회 옵션을 붙입니다.

**Q. Codex가 아니라 macOS/Linux CLI와 API 키로도 같은 방식으로 진행할 수 있나요?**
네. 같은 `AGENTS.md`, `PLANS.md`, backlog/active/archive 규칙을 사용합니다. 차이는 인터페이스뿐이며, API 직접 호출은 `.env.local`에 `HARNESS_AGENT_MODE=api`와 provider key를 넣고 `npm run harness -- run-agent --role <role>`를 사용합니다.

**Q. 모델을 바꾸고 싶어요.**
`.env.local`에서 `OPENAI_MODEL=gpt-5.2`처럼 덮어쓰면 됩니다.

**Q. 새 스킬을 추가하려면?**
`docs/skills/새스킬.md`를 만들고 `AGENTS.md`의 세부 문서 링크 테이블에 추가하세요.

**Q. 이 하네스가 맞지 않는 프로젝트 타입은?**
단일 스크립트, 1회성 실험 코드에는 과도합니다. 팀 협업이 있거나 장기 유지보수가 필요한 프로젝트에 적합합니다.

## Verification performance options

Full verification is never cached and remains the only completion gate. Quick verification caches only successful results and reuses them when repository content, selected commands, Node version, OS, and architecture are identical.

```json
{
  "verify": {
    "quick_cache": true,
    "parallel_scripts": ["coverage", "lint"]
  }
}
```

`parallel_scripts` is empty by default. Add only npm scripts that are independent and safe to run concurrently. The Full verifier also skips a `build` script when it is only an exact alias of another selected script, such as `npm run lint`.

Environment overrides are available as `HARNESS_VERIFY_QUICK_CACHE=true|false` and a comma-separated `HARNESS_VERIFY_PARALLEL_SCRIPTS=coverage,lint`.