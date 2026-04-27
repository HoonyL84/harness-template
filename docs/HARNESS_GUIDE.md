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
│   ├── verify-task.sh               ← 검증 (테스트+빌드)
│   ├── complete-task.sh             ← 완료 및 GC
│   ├── scan-drift.sh                ← Drift 자동 감지
│   ├── run-agent.sh                 ← AI API 직접 호출
│   └── utils.sh                     ← Slack 알림 공통 함수
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
cp .env.template .env.local
# .env.local을 열고 아래 항목 입력:
# - SLACK_WEBHOOK_URL (작업 알림)
# - OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (AI 사용 시)
```

### Step 3. 의존성 설치 (Git Hooks 활성화)
```bash
npm install
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

### Step 5. 첫 태스크 시작
```bash
bash scripts/start-task.sh user-auth feat
cd .worktrees/user-auth
# 여기서 구현 작업
bash scripts/verify-task.sh
git add -A
git commit -m "feat(auth): JWT 기반 사용자 인증 구현"
cd ../..
bash scripts/complete-task.sh user-auth
```

---

## 🤖 AI 에이전트 활용 방법

### 방법 1: 툴 방식 (Antigravity, Cursor, Claude Code 등)
별도 설정 없이 AI가 `AGENTS.md`를 읽고 규칙대로 작업.

### 방법 2: API 직접 호출 (토큰 방식)

```bash
# .env.local에 API 키 설정 후

# 일반 코드 생성 (저렴한 모델 자동 선택)
bash scripts/run-agent.sh --type code "UserRepository CRUD 구현해줘"

# 아키텍처 설계 (강력한 모델 자동 선택)
bash scripts/run-agent.sh --type architect "Redis + MySQL 하이브리드 캐싱 설계해줘"

# 코드 리뷰
bash scripts/run-agent.sh --type review "이번 PR 코드 리뷰해줘"

# 문서 작성
bash scripts/run-agent.sh --type docs "API 문서 작성해줘"
```

**모델 자동 라우팅:**

| Task Type | OpenAI | Anthropic | Gemini |
|-----------|--------|-----------|--------|
| `code` / `docs` | gpt-5.5 | claude-haiku-4-5 | gemini-3-flash |
| `review` / 기본 | gpt-5.5 | claude-sonnet-4-6 | gemini-3-flash |
| `architect` | gpt-5.5-pro | claude-opus-4-7 | gemini-3.1-pro |

**Provider 선택:**
```bash
AI_PROVIDER=anthropic bash scripts/run-agent.sh --type architect "설계해줘"
```

---

## ⚙️ 자동화 메커니즘

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
`bash` 실행을 위해 WSL 또는 Git Bash가 필요합니다.

**Q. 모델을 바꾸고 싶어요.**
`.env.local`에서 `OPENAI_MODEL=gpt-5.5-pro`처럼 덮어쓰면 됩니다.

**Q. 새 스킬을 추가하려면?**
`docs/skills/새스킬.md`를 만들고 `AGENTS.md`의 세부 문서 링크 테이블에 추가하세요.

**Q. 이 하네스가 맞지 않는 프로젝트 타입은?**
단일 스크립트, 1회성 실험 코드에는 과도합니다. 팀 협업이 있거나 장기 유지보수가 필요한 프로젝트에 적합합니다.
