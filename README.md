# 🔧 Harness Engineering Template

> AI 에이전트와 인간 개발자가 함께 일하기 위한 범용 개발 OS 템플릿

---

## 📐 구조

```
├── AGENTS.md                  ← 에이전트 헌법 (모든 AI가 가장 먼저 읽는다)
├── docs/
│   └── project/
│       └── PLANS.md           ← 프로젝트 목표 및 기술 스택 (사용자가 채운다)
├── scripts/
│   ├── start-task.sh          ← 태스크 시작 (워크트리 + EXEC_PLAN 생성)
│   ├── verify-task.sh         ← 전체 검증 (테스트 + 린트 + 빌드)
│   ├── complete-task.sh       ← 태스크 완료 및 GC
│   └── utils.sh               ← Slack 알림 공통 함수
├── .harness/
│   └── tasks/
│       ├── active/            ← 진행 중인 태스크 EXEC_PLAN
│       └── archive/           ← 완료된 태스크 기록
├── .husky/                    ← Git Hooks (커밋 형식, 금지 패턴 강제)
├── .env.template              ← 환경 변수 템플릿
└── docker-compose.yml         ← 로컬 개발 인프라 (Redis, Kafka, MySQL, ES)
```

---

## 🚀 새 프로젝트 시작 방법

### 1. 이 레포를 템플릿으로 사용
GitHub에서 **"Use this template"** 클릭 → 새 레포 생성

### 2. 환경 변수 설정
```bash
cp .env.template .env.local
# .env.local 열고 SLACK_WEBHOOK_URL, GITHUB_TOKEN 등 실제 값 입력
```

### 3. 의존성 설치 (Git Hooks 활성화)
```bash
npm install
```

### 4. 로컬 인프라 실행 (선택)
```bash
docker-compose up -d
```

### 5. PLANS.md 작성
`docs/project/PLANS.md`에 프로젝트 목표, 스택, 로드맵 작성

### 6. 첫 태스크 시작
```bash
bash scripts/start-task.sh <task-name> feat
cd .worktrees/<task-name>
# 여기서 작업
bash scripts/verify-task.sh
git commit -m "feat(scope): 설명"
bash scripts/complete-task.sh <task-name>
```

---

## ⚙️ Git Hooks (자동 강제)

| Hook | 역할 |
|------|------|
| `commit-msg` | 커밋 메시지 형식 강제: `feat(scope): 설명` |
| `pre-commit` | `console.log` / `System.out.println` 커밋 차단 |

---

## 📋 커밋 타입

| type | 용도 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 |
| `test` | 테스트 |
| `docs` | 문서 |
| `chore` | 빌드, 의존성 |

---

## 🤖 AI 에이전트 사용 시

에이전트는 레포 진입 시 자동으로 `AGENTS.md`를 읽고 규칙을 따릅니다.
별도 지시 없이도 코딩 컨벤션, 커밋 규칙, 워크트리 격리가 적용됩니다.
