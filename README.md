# 🔧 Harness Engineering Template

> AI 에이전트와 인간 개발자가 함께 일하기 위한 범용 개발 OS 템플릿

**"소프트웨어 엔지니어링의 핵심은 코드를 짜는 것이 아니라, 에이전트가 잘 일할 수 있는 환경(Harness)을 설계하는 것이다."**

이 레포지토리는 OpenAI의 Harness Engineering 철학을 기반으로 만들어진 **가장 완벽한 에이전트 우선(Agent-first) 작업 환경**입니다.

---

## 📖 사용 설명서

전체 아키텍처, 스크립트 사용법, AI 모델 라우팅, 스킬(Skill) 사용법 등 상세한 가이드는 아래 문서를 확인하세요.

👉 **[Harness Engineering 종합 가이드 읽기 (HARNESS_GUIDE.md)](docs/HARNESS_GUIDE.md)**

---

## 📐 디렉토리 구조 요약

```
scratch/
├── AGENTS.md                  ← 에이전트 헌법 (모든 AI가 가장 먼저 읽는 목차, 40줄)
├── docs/
│   ├── HARNESS_GUIDE.md       ← 종합 사용 설명서
│   ├── project/PLANS.md       ← 🔑 프로젝트 목표 및 기술 스택 (사용자가 채운다)
│   ├── design-docs/           ← 아키텍처 원칙, 코딩 컨벤션
│   └── skills/                ← 에이전트가 사용하는 행동 절차 (코드리뷰, 자가진단 등)
├── scripts/
│   ├── start-task.sh          ← 태스크 시작 (워크트리 + EXEC_PLAN 생성)
│   ├── verify-task.sh         ← 전체 검증 (테스트 + 린트 + 커버리지 + 빌드)
│   ├── complete-task.sh       ← 태스크 완료 및 GC
│   ├── run-agent.sh           ← AI API 직접 호출 (비용/성능 기반 자동 라우팅)
│   ├── decompose-task.sh      ← AI 기반 큰 태스크 자동 분해
│   └── scan-drift.sh          ← 코드/문서 간 괴리(Drift) 자동 감지
├── .github/                   ← PR 템플릿, 자동 의존성 업데이트, 보안 스캔 CI
├── .husky/                    ← Git Hooks (커밋 형식, 금지 패턴 강제 차단)
└── .harness/                  ← 진행/완료된 태스크 기록 및 에이전트 실행 로그
```

---

## 🚀 3분 퀵 스타트

1. **템플릿 복제**: GitHub에서 **"Use this template"** 클릭하여 내 레포지토리 생성
2. **환경 설정**: `cp .env.template .env.local` 후 API 키 및 슬랙 웹훅 입력
3. **의존성 설치**: `npm install` (Husky Git Hook 자동 활성화)
4. **목표 작성**: `docs/project/PLANS.md`에 만들고자 하는 프로젝트 설명 기입
5. **태스크 자동 분해 & 시작**:
   ```bash
   bash scripts/decompose-task.sh "광고 서비스 백엔드 전체 구현해줘"
   ```

에이전트는 레포 진입 시 자동으로 `AGENTS.md`를 읽고 하네스 규칙을 엄격하게 따릅니다. 별도 지시 없이도 코딩 컨벤션, 커밋 규칙, 워크트리 격리가 완벽하게 적용됩니다.
