# Execution Modes

이 문서는 하네스가 어떤 실행 환경에서 어떻게 동작해야 하는지 정의한다.
목표는 특정 IDE나 특정 OS에 묶이지 않고, 같은 프로젝트 규칙을 Windows, macOS, Linux, GitHub Actions, API-key 기반 CLI에서 반복 가능하게 만드는 것이다.

---

## 1. 지원 원칙

1. **규칙은 파일에 남긴다.** 대화에서 결정된 내용은 `PLANS.md`, backlog/active/archive 티켓, ADR, memory 중 하나에 기록한다.
2. **에이전트 표면은 바뀔 수 있다.** Codex, Claude Code, Gemini CLI, GitHub Copilot, API 직접 호출은 인터페이스만 다르며 `AGENTS.md`와 설계 문서를 같은 기준으로 읽어야 한다.
3. **핵심 로직은 공통 CLI에 둔다.** `tools/harness-cli/index.js`가 OS 공통 실행 레이어이며, Bash/PowerShell 스크립트는 호환용 wrapper로 유지한다.
4. **검증은 로컬과 CI에서 반복 가능해야 한다.** 로컬 검증이 불가능한 환경이면 이유를 남기고 GitHub Actions 결과로 보완한다.
5. **API 키는 선택 사항이다.** 대화형 에이전트 환경에서는 API 키 없이도 사람이 승인하며 진행할 수 있고, CLI 자동 호출 시에만 `.env.local`의 키가 필요하다.

---

## 2. 실행 모드 매트릭스

| Mode | 주 사용 환경 | 인증/키 | 권장 명령 | 현재 지원 수준 | 비고 |
|------|--------------|---------|-----------|----------------|------|
| Codex/Cursor/Claude Code 같은 대화형 에이전트 | Windows/macOS/Linux | 해당 도구 로그인 세션 | 대화 + 파일 수정 + Git | 1급 지원 | 에이전트가 `AGENTS.md`를 읽고 사용자의 승인 흐름을 따른다. |
| Node Harness CLI | Windows/macOS/Linux | 선택: `.env.local` API 키 | `npm run harness -- <command>` | 1급 지원 | OS 공통 기준 명령이다. |
| Unix Bash CLI | macOS/Linux/WSL/Git Bash | 선택: `.env.local` API 키 | `bash scripts/*.sh` | 호환 지원 | 내부적으로 Node Harness CLI를 호출한다. |
| Windows PowerShell CLI | Windows | 선택: `.env.local` API 키 | `powershell -File scripts/*.ps1` | 호환 지원 | 내부적으로 Node Harness CLI를 호출한다. |
| GitHub Actions | GitHub hosted runner | GitHub token, optional secrets | `.github/workflows/*.yml` | 1급 지원 | CI/security가 로컬 OS 차이를 보완하는 최종 검증선이다. |
| API-key Agent CLI | Windows/macOS/Linux | `OPENAI_API_KEY` 또는 호환 provider key | `npm run harness -- run-agent --role <role>` | 1급 지원 | 로컬에서 에이전트를 직접 호출할 때 사용한다. |

---

## 3. OS별 권장 흐름

작업 환경을 바꿨다면 먼저 preflight를 실행한다.

```bash
npm run harness -- check
```

```powershell
npm run harness -- check
```

preflight는 필수 도구, `.env.local`, `HARNESS_AGENT_MODE`, provider key, Git remote, 작업 트리 변경, active 티켓 수, 줄바꿈 정책을 점검한다.

### macOS/Linux/WSL

```bash
cp .env.template .env.local
npm install
npm run harness -- check
npm run harness -- create-ticket my-task feat --goal "작업 목표"
npm run harness -- start-ticket my-task
npm run harness -- verify
git add -A
git commit -m "feat: 작업 설명"
npm run harness -- complete-task my-task
```

### Windows PowerShell

```powershell
Copy-Item .env.template .env.local
npm install
npm run harness -- check
npm run harness -- create-ticket my-task feat --goal "작업 목표"
npm run harness -- start-ticket my-task
npm run harness -- verify
git add -A
git commit -m "feat: 작업 설명"
npm run harness -- complete-task my-task --force
```

PowerShell만 사용할 때도 같은 Node Harness CLI를 사용하므로 티켓 기록, 검증 로그, API 호출 방식이 macOS/Linux와 동일한 로직을 따른다.

### GitHub Actions

GitHub Actions는 로컬 환경의 차이를 줄이기 위한 공통 검증선이다.

- `ci.yml`: Node/Java 프로젝트를 감지해 테스트와 빌드를 수행한다.
- `security.yml`: 의존성 취약점과 secret 노출을 검사한다.
- Dependabot: GitHub Actions와 npm 의존성을 주기적으로 갱신한다.

---

## 4. API 키 사용 기준

API 키는 대화형 Codex 작업에는 필수가 아니다. 아래 경우에만 필요하다.

- `npm run harness -- run-agent`로 로컬에서 모델 API를 직접 호출할 때
- CI나 외부 자동화에서 에이전트 응답을 생성해야 할 때
- 특정 provider/model을 `.env.local`로 고정해야 할 때

권장 환경 변수:

```bash
HARNESS_AGENT_MODE=api
AI_PROVIDER=openai
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

API 키는 커밋하지 않는다. 필요한 값은 `.env.local`에 두고, 공유해야 할 키 이름만 `.env.template`에 남긴다.
`HARNESS_AGENT_MODE=interactive` 상태에서는 대화형 Codex/Cursor/Claude Code 사용을 기본으로 보고, `run-agent` 직접 호출은 막는다.
회사 macOS처럼 토큰 기반 CLI를 쓸 때는 `.env.local`에서 `HARNESS_AGENT_MODE=api`로 바꾼 뒤 provider key를 넣는다.

---

## 5. 현재 알려진 제한

- legacy Bash/PowerShell wrapper는 Node Harness CLI를 호출하므로 Node.js가 필수다.
- Git Bash/WSL 실행 가능 여부와 무관하게 `npm run harness -- ...`가 우선 경로다.
- macOS/Linux/Windows 로컬 실행은 구조상 지원하지만, 최종 호환성은 GitHub Actions와 실제 CLI 실행으로 주기적으로 확인해야 한다.

---

## 6. 개선 우선순위

1. CLI smoke test 추가: `check/create/start/verify/complete`가 Windows/macOS/Linux에서 같은 결과를 내는지 검증한다.
2. API provider dry-run 추가: 실제 토큰 없이 provider/model 선택 결과를 출력한다.
3. macOS/Linux smoke test 문서화: 새 템플릿 복제 후 create/start/verify/complete까지 검증한다.
