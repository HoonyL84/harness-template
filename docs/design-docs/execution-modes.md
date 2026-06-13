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
| L4.5 Auto-fix | Windows/macOS/Linux | provider API key + 명시적 opt-in | `npm run harness -- verify --auto-fix` | 제한적 지원 | 저위험 기존 소스/테스트 파일만 1회 수정하고 재검증하며, 실패 시 원복한다. |
| L5 Interactive | Windows/macOS/Linux | 대화형 도구 로그인 세션 | `npm run harness -- autonomy` | Experimental | 현재 세션 안에서 체크포인트 기반으로 연속 수행한다. |
| L5 API | Windows/macOS/Linux | provider API key | `npm run harness -- autonomy` | Experimental | clean worktree에서 예산 한도 내 독립 루프를 수행한다. |
| Multi-agent Interactive Native | 하위 에이전트를 지원하는 대화형 host | host 로그인 세션 | `npm run harness -- orchestrate <ticket> --mode auto` | Experimental, opt-in | native host adapter가 생성·메시지·대기·취소를 담당하고 하네스는 계획·artifact·상태·승인 계약을 관리한다. |
| Multi-agent API Managed | Windows/macOS/Linux | role별 provider API key | `npm run harness -- orchestrate <ticket> --mode api` | Experimental, opt-in | orchestrator가 API 요청과 공통 artifact를 관리하며 L5 호출·시간·재시도 예산을 공유한다. |
| Multi-agent Sequential Fallback | 하위 에이전트 미지원 CLI | 실행 표면에 따른 인증 | `npm run harness -- orchestrate <ticket> --mode sequential` | Experimental, opt-in | 호스트가 역할 요청을 하나씩 수행하고 artifact를 기록한 뒤 다음 역할로 진행한다. |

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
`.env.local`이 없으면 `.env.template`에서 자동 생성한다.
PowerShell에서 `npm`이 실행 정책에 막히면 `npm.cmd run harness -- check`를 사용한다.

active 티켓은 기본적으로 하나만 유지한다. 병렬 작업이 필요하면 `start-ticket <name> --allow-parallel`을 명시하고,
공통 작업 트리에서 검증할 때는 `verify --task <name>`으로 메트릭 귀속을 명확히 해야 한다.

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
# 원격 저장소가 설정된 경우에만: git push
npm run harness -- complete-task my-task
git add -A
git commit -m "chore(harness): my-task 완료 기록"
# 원격 저장소가 설정된 경우에만: git push
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
# 원격 저장소가 설정된 경우에만: git push
npm run harness -- complete-task my-task --force
git add -A
git commit -m "chore(harness): my-task 완료 기록"
# 원격 저장소가 설정된 경우에만: git push
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

L4.5 자동 수정은 추가로 `HARNESS_AUTO_FIX=true`를 설정하거나 `verify --auto-fix`를 명시해야 한다.
자동 수정 범위와 원복 규칙은 `docs/design-docs/auto-fix-policy.md`를 따른다.

선택형 L5는 `HARNESS_AUTONOMY_LEVEL=5`를 추가로 설정해야 한다.
interactive와 API 모드는 같은 티켓·검증·체크포인트 규칙을 사용하지만,
interactive는 세션 수명과 도구 권한에 종속되고 API는 독립 반복 실행이 가능하다.
세부 한도와 승인 경계는 `docs/design-docs/l5-autonomy-policy.md`를 따른다.

## 5. 선택형 멀티에이전트 실행

멀티에이전트는 기존 단일 에이전트 실행을 대체하지 않는다. 프로젝트 설정이 없거나 비활성화된 경우에는 `orchestrate`를 실행하지 않으며, 현재의 `run-agent`, `autonomy`, 티켓 흐름을 그대로 사용한다.

```bash
npm run harness -- orchestrate <ticket> --mode auto --max-workers 2
npm run harness -- orchestrate --capabilities
npm run harness -- orchestrate --status <run-id>
npm run harness -- orchestrate --resume <run-id>
npm run harness -- orchestrate --approve <run-id>
npm run harness -- orchestrate --begin-review <run-id>
npm run harness -- orchestrate --finish <run-id>
```

`--mode auto`는 다음 우선순위로 adapter를 선택한다.

1. CLI에서 명시한 adapter
2. interactive host가 주입한 native capability manifest
3. API provider 설정
4. `sequential-local` fallback

명령의 존재만으로 native 병렬 지원을 추정하지 않는다. adapter의 `capabilities()`가 delegation, parallel, isolated context, tool access, workspace write, approval, cancellation 지원 여부를 보고해야 한다.

### Interactive Native Host Adapter

Codex처럼 하위 에이전트를 지원하는 host에서는 adapter가 에이전트 생성, 메시지 전달, 대기, 취소를 담당한다. 하네스는 host 고유 세션 ID에 의존하지 않고 공통 role artifact와 orchestration 상태만 저장한다.

Phase 1에서는 분석 역할만 병렬화하고 workspace writer는 하나로 제한한다. Phase 2 multi-writer는 겹치지 않는 `owned_paths`, 동일한 base SHA, worker별 격리 branch/worktree가 확인된 경우에만 별도 opt-in으로 허용한다.

### API Managed

`HARNESS_AGENT_MODE=api`에서는 역할별 provider 요청을 실행하고 결과를 공통 artifact로 정규화한다. API 호출 수, provider 요청 수, 재시도, 실행 시간은 기존 L5 예산에 합산하며 일부 역할 실패는 성공 artifact를 폐기하지 않고 해당 역할만 재시도한다.

### Sequential Fallback

native delegation 또는 병렬 capability가 없으면 실패로 종료하지 않고 동일한 역할 그래프를 host-driven 순차 방식으로 진행한다. CLI는 한 번에 하나의 역할 요청만 만들며, 호스트 또는 사용자가 결과 artifact를 기록해야 다음 역할 요청이 열린다. 순차 fallback도 frozen plan, 단일 writer, 분리된 reviewer/verifier, 승인 대기, 최종 `verify --full` 규칙을 그대로 지킨다.

### 통합과 완료

- Phase 1의 구현 diff와 Phase 2 worker 결과는 사용자 승인 전 자동 통합하지 않는다.
- stale base, 소유 경로 이탈, worker 검증 실패, commit/diff hash 불일치, 통합 충돌은 중단 상태로 남긴다.
- Phase 2 통합은 별도 integration branch/worktree에서 계획된 순서로 수행한다.
- 역할 artifact가 요청한 고위험 결정은 `orchestrate --approve <run-id>`로 승인 상태를 전이한다.
- worker 통합과 parent branch 승격은 각각 `--integrate <run-id> --approve-risk`, `--promote <run-id> --approve-risk`로 별도 승인한다.
- 통합 branch의 `verify --full` 성공 지문이 없으면 `complete-task`를 실행할 수 없다.

---

## 6. 현재 알려진 제한

- legacy Bash/PowerShell wrapper는 Node Harness CLI를 호출하므로 Node.js가 필수다.
- Git Bash/WSL 실행 가능 여부와 무관하게 `npm run harness -- ...`가 우선 경로다.
- macOS/Linux/Windows 로컬 실행은 구조상 지원하지만, 최종 호환성은 GitHub Actions와 실제 CLI 실행으로 주기적으로 확인해야 한다.
- native adapter의 실제 병렬성, 취소, tool access는 host capability에 따라 다르며 미지원 기능은 순차 fallback으로 축소된다.

---

## 7. 개선 우선순위

1. API provider dry-run 추가: 실제 토큰 없이 provider/model 선택 결과를 출력한다.
2. 실제 provider를 이용한 장시간 L5 안정성 표본을 누적한다.
3. 현재 커버리지 기준을 회귀 없이 점진적으로 상향한다.
