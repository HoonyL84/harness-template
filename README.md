> [!IMPORTANT]
> Windows users: run scripts with **WSL** or **Git Bash** (`bash` required).
> PowerShell/CMD alone may fail for `scripts/*.sh`.
>
> [!NOTE]
> Recommended text encoding for this repository is **UTF-8**.
> If Korean text appears broken in terminal, switch terminal/codepage to UTF-8.

# Harness Engineering Template

> AI 에이전트와 인간 개발자가 함께 일하기 위한 범용 개발 운영 템플릿

이 저장소는 단순 코드 스캐폴딩이 아니라, 에이전트가 안전하고 일관되게 일하도록 만드는 **작업 하네스(Harness)**를 제공합니다.

## 빠른 시작

1. 템플릿 복제 후 클론
2. `cp .env.template .env.local` 로 환경 변수 파일 생성
3. `npm install` 로 Husky/commitlint 설치
4. `docs/project/PLANS.md` 작성 (프로젝트 목표/로드맵)
5. `bash scripts/start-task.sh <task-name> <feat|fix|refactor>` 로 첫 태스크 시작

## 문서 진입점

- 전체 사용 가이드: [docs/HARNESS_GUIDE.md](docs/HARNESS_GUIDE.md)
- 에이전트 작업 규칙: [AGENTS.md](AGENTS.md)
- 프로젝트 목표 문서: [docs/project/PLANS.md](docs/project/PLANS.md)
- 메모리 운영 규칙: [docs/design-docs/memory-governance.md](docs/design-docs/memory-governance.md)

## 디렉터리 요약

```text
scratch/
├── AGENTS.md
├── docs/
├── scripts/
├── prompts/
├── tools/
├── memory/
├── evals/
└── observability/
```

## 핵심 스크립트

- `scripts/start-task.sh`: 워크트리 + EXEC_PLAN 생성
- `scripts/verify-task.sh`: 테스트/린트/빌드/정책 검증
- `scripts/verify-task.sh --offline`: 네트워크/키 없는 환경용 로컬 검증
- `scripts/complete-task.sh`: 태스크 종료 및 기록 정리
- `scripts/scan-drift.sh`: 운영 드리프트 점검
- `scripts/health-check.sh`: 필수 구조/파일/최근 verify 상태 점검
- `scripts/load-context.sh`: 에이전트용 컨텍스트 번들 생성 (`run-agent.sh`가 자동 사용)
- `scripts/validate-memory.sh`: memory frontmatter 규칙 점검

## 참고

- 템플릿 저장소이므로 일부 파일(예: `docs/project/PLANS.md`, `tools/registry.yaml`)은 의도적으로 기본 골격만 제공합니다.
- 표준 스킬 구조는 `skills/<skill_name>/`를 사용합니다.
