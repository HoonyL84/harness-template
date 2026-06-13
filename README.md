> [!NOTE]
> Recommended text encoding for this repository is **UTF-8**.
> If Korean text appears broken in terminal, switch terminal/codepage to UTF-8.
> For Java source files on Windows, prefer **UTF-8 without BOM**. PowerShell 5 `Set-Content -Encoding UTF8` may create a BOM that `javac` rejects.
>
> Windows PowerShell에서 `npm`이 실행 정책 오류로 막히면 `npm.cmd run harness -- check`를 사용하세요.
> `.ps1` wrapper를 직접 실행할 때는 `powershell -ExecutionPolicy Bypass -File scripts/check-environment.ps1`처럼 실행할 수 있습니다.

# Harness Engineering Template

> AI 에이전트와 인간 개발자가 함께 일하기 위한 범용 개발 운영 템플릿

이 저장소는 단순 코드 스캐폴딩이 아니라, 에이전트가 안전하고 일관되게 일하도록 만드는 **작업 하네스(Harness)**를 제공합니다.

## 빠른 시작

1. 템플릿 복제 후 클론
2. `npm run harness -- check` 로 `.env.local` 자동 생성 및 환경 점검
3. `npm install` 로 Husky/commitlint 설치
4. `docs/project/PLANS.md` 작성 (프로젝트 목표/로드맵)
5. `scripts/create-ticket.*`로 backlog 티켓 생성 후 `scripts/start-ticket.*`로 active 승격

공통 실행 명령은 OS와 상관없이 아래 형식을 권장합니다.

```bash
npm run harness -- check
npm run harness -- create-ticket my-task feat --goal "작업 목표"
npm run harness -- start-ticket my-task
npm run harness -- verify
npm run harness -- complete-task my-task --force
git add -A
git commit -m "chore(harness): my-task 완료 기록"
```

기본적으로 active 티켓은 하나만 허용합니다. 병렬 작업은 `start-ticket <name> --allow-parallel`로 명시하고,
검증할 때 `npm run harness -- verify --task <name>`처럼 대상 티켓을 지정하세요.

## 문서 진입점

- 전체 사용 가이드: [docs/HARNESS_GUIDE.md](docs/HARNESS_GUIDE.md)
- 에이전트 작업 규칙: [AGENTS.md](AGENTS.md)
- GitHub Copilot 규칙: [.github/copilot-instructions.md](.github/copilot-instructions.md)
- Claude/Gemini 진입점: [CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md)
- AI 문서 지도: [llms.txt](llms.txt)
- 프로젝트 목표 문서: [docs/project/PLANS.md](docs/project/PLANS.md)
- 에이전트 역할 정의: [docs/design-docs/agent-roles.md](docs/design-docs/agent-roles.md)
- 실행 모드/OS 호환성: [docs/design-docs/execution-modes.md](docs/design-docs/execution-modes.md)
- L4.5 자동 수정 정책: [docs/design-docs/auto-fix-policy.md](docs/design-docs/auto-fix-policy.md)
- 선택형 L5 자율 실행 정책: [docs/design-docs/l5-autonomy-policy.md](docs/design-docs/l5-autonomy-policy.md)
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
- `scripts/create-ticket.sh` / `scripts/create-ticket.ps1`: backlog 티켓 생성
- `scripts/start-ticket.sh` / `scripts/start-ticket.ps1`: backlog 티켓을 active로 승격
- `scripts/verify-task.sh` / `scripts/verify-task.ps1`: 테스트/린트/빌드/정책 검증
- `npm run harness -- verify --auto-fix`: API 모드에서 저위험 소스/테스트 패치를 1회 적용하고 재검증, 실패 시 원복
- `scripts/verify-task.sh --offline` / `scripts/verify-task.ps1 -Offline`: 네트워크/키 없는 환경용 로컬 검증
- `scripts/check-environment.sh` / `scripts/check-environment.ps1`: OS/토큰/필수 도구/Git 상태 사전 점검
- `scripts/run-agent.sh` / `scripts/run-agent.ps1`: Planner/Reviewer 등 역할 프롬프트로 AI 호출
- `scripts/complete-task.sh`: 태스크 종료 및 기록 정리
- `scripts/complete-task.ps1`: Windows/PowerShell 환경용 태스크 종료 및 기록 정리
- `scripts/scan-drift.sh`: 운영 드리프트 점검
- `scripts/health-check.sh`: 필수 구조/파일/최근 verify 상태 점검
- `tools/harness-cli/index.js`: OS 공통 실행 레이어 및 API 에이전트 컨텍스트 번들 기준
- `scripts/load-context.sh`: legacy/Unix 파이프라인용 컨텍스트 출력기
- `scripts/validate-memory.sh`: memory frontmatter 규칙 점검

## 실행 환경

- 대화형 에이전트(Codex/Cursor/Claude Code 등): `AGENTS.md`와 `PLANS.md`를 기준으로 진행
- macOS/Linux/WSL/Git Bash: `npm run harness -- ...` 또는 `bash scripts/*.sh` 지원
- Windows PowerShell: `npm run harness -- ...` 또는 `scripts/*.ps1` 지원
- GitHub Actions: CI/security로 공통 검증
- API-key CLI: `.env.local`에 `HARNESS_AGENT_MODE=api`와 provider key를 두고 `npm run harness -- run-agent --role <role>` 사용

자세한 지원 범위와 제한은 [docs/design-docs/execution-modes.md](docs/design-docs/execution-modes.md)를 기준으로 판단하세요.

작업 환경을 바꿨다면 시작 전에 아래 중 하나를 먼저 실행하세요.

```bash
npm run harness -- check
```

```powershell
npm.cmd run harness -- check
```

`check`는 `.env.local`이 없으면 `.env.template`에서 자동 생성합니다. 생성된 `.env.local`에 필요한 API 키와 provider 옵션을 채우면 됩니다.

## 품질 검증

```bash
npm test
npm run coverage
npm run lint
npm run build
npm run harness -- verify --full
```

`coverage`는 전체 CLI 테스트의 최소 lines/statements 65%, functions/branches 70%를
강제합니다. 이 기준은 신규 모듈 테스트와 함께 점진적으로 높입니다.

## 선택형 멀티에이전트

멀티에이전트 orchestration은 기본적으로 비활성화된 실험 기능입니다. 단일 에이전트 작업 흐름은 그대로 유지되며, 역할 분리나 격리된 병렬 작업이 필요한 티켓에서만 명시적으로 사용합니다.

```bash
npm run harness -- orchestrate --capabilities
npm run harness -- orchestrate <ticket> --mode auto --max-workers 2
npm run harness -- orchestrate --status <run-id>
```

- `auto`: 실행 환경이 지원하면 native 또는 API adapter를 선택하고, 아니면 sequential로 안전하게 전환합니다.
- `native`: Codex처럼 하위 에이전트를 지원하는 대화형 host에서 사용합니다.
- `api`: provider API key 기반으로 역할별 실행을 관리합니다.
- `sequential`: 병렬 실행을 지원하지 않는 CLI에서도 같은 artifact와 승인 흐름을 유지합니다.

상세한 승인, worker 격리, 통합 및 재개 절차는 [HARNESS_GUIDE.md](docs/HARNESS_GUIDE.md#선택형-멀티에이전트-orchestration)를 참고하세요.

## L4.5 제한적 자동 수정

기본값은 비활성화입니다. `.env.local`에서 `HARNESS_AGENT_MODE=api`, provider API 키,
`HARNESS_AUTO_FIX=true`를 설정하거나 명령에 `--auto-fix`를 전달하면 검증 실패를 한 번 복구합니다.

```bash
npm run harness -- verify --auto-fix
```

자동 수정은 기존 소스/테스트 파일 최대 5개와 100KB 패치로 제한됩니다. 설정, 의존성, CI,
스크립트, 인프라, migration, 비밀값은 수정하지 않으며 재검증 실패 시 패치를 원복합니다.
커밋과 푸시는 자동으로 수행하지 않습니다. 상세 기준은
[L4.5 자동 수정 정책](docs/design-docs/auto-fix-policy.md)을 참고하세요.

## L5 Experimental

L5는 기본 비활성화이며 사용자가 위험과 실행 환경 차이를 감수하고 명시적으로 켭니다.

```env
HARNESS_AUTONOMY_LEVEL=5
HARNESS_MAX_ITERATIONS=3
HARNESS_MAX_API_CALLS=6
HARNESS_MAX_RUNTIME_MINUTES=30
```

```bash
npm run harness -- autonomy
npm run harness -- autonomy --status
```

- `interactive`: 현재 Codex/Cursor/Claude Code 세션이 체크포인트를 따라 연속 수행
- `api`: provider API가 clean worktree에서 제한된 독립 실행 루프 수행
- 고위험 패치: 적용 전 `approval_required`로 중단
- 프롬프트: `prompts/templates/`에서 수정 가능
- API 일시 오류: `Retry-After`와 지수 백오프로 제한 재시도
- 복구: 하네스 패치만 역적용하며 자동 `reset --hard`/`clean -fd` 금지
- 자동 커밋/푸시: 별도 opt-in이며 main/master 자동 커밋은 항상 차단

상세 설정은 [L5 자율 실행 정책](docs/design-docs/l5-autonomy-policy.md)을 참고하세요.

## 참고

- 템플릿 저장소이므로 일부 파일(예: `docs/project/PLANS.md`, `tools/registry.yaml`)은 의도적으로 기본 골격만 제공합니다.
- 표준 스킬 구조는 `skills/<skill_name>/`를 사용하며, `SKILL.md`는 YAML frontmatter의 `name`/`description`을 포함합니다.
- 템플릿을 복제한 뒤 `package.json`의 이름/버전을 바꾸면 `npm install --package-lock-only --ignore-scripts`로 `package-lock.json` 메타데이터를 갱신하세요.
