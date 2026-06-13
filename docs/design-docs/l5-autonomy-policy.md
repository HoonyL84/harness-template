# L5 Experimental Autonomy Policy

L5는 사용자가 명시적으로 활성화하는 bounded autonomy 모드다. 기본 실행 수준은 L4.5이며,
`HARNESS_AUTONOMY_LEVEL=5`일 때만 `autonomy` 명령이 실행된다.

## 공통 한도

- 최대 티켓 반복 수: `HARNESS_MAX_ITERATIONS`
- 최대 주요 AI 호출 수: `HARNESS_MAX_API_CALLS`
- 최대 실행 시간: `HARNESS_MAX_RUNTIME_MINUTES`
- 패치 최대 크기/파일 수: `HARNESS_L5_MAX_PATCH_KB`, `HARNESS_L5_MAX_FILES`
- 비밀값, `.git`, `.harness`, observability 상태는 자동 패치 금지
- rename, copy, binary patch는 자동 적용 금지
- main/master 자동 커밋 금지
- planner/implementer/system 프롬프트는 `prompts/templates/`에서 로드
- 429, 일시적 5xx, 네트워크 순단은 설정된 지수 백오프로 재시도

## Interactive 모드

```env
HARNESS_AGENT_MODE=interactive
HARNESS_AUTONOMY_LEVEL=5
```

```bash
npm run harness -- autonomy
```

대화형 Codex/Cursor/Claude Code가 현재 세션 안에서 active 티켓을 구현한다.
CLI는 active/backlog 선택과 체크포인트를 관리하고 다음 행동을 출력한다.
세션 종료, 권한 승인, 도구의 토큰 제한에서는 멈출 수 있다.

현재 티켓 검증:

```bash
npm run harness -- autonomy --verify-current
```

## API 모드

```env
HARNESS_AGENT_MODE=api
HARNESS_AUTONOMY_LEVEL=5
```

API 모드는 clean worktree에서 독립 루프를 실행한다.

1. active 티켓이 없으면 backlog 첫 티켓을 시작한다.
2. backlog도 없으면 `PLANS.md`를 JSON 티켓으로 분해한다.
3. 구현 패치를 생성하고 정책 검사를 수행한다.
4. 패치를 적용하고 전체 검증을 실행한다.
5. 검증 실패 시 패치를 원복하고 중단한다.
6. 자동 커밋이 꺼져 있으면 검토 체크포인트에서 멈춘다.
7. 자동 커밋이 켜져 있으면 task branch에서만 커밋하고 다음 티켓으로 진행한다.

L5의 `verified` 및 완료 판정은 `verify --full`의 `last_full` 지문만 인정한다.
`verify --quick` 결과는 개발 중 참고 정보로만 별도 보존하며 완료 권한을 부여하지 않는다.
실제 provider 장기 호출을 대체하는 결정론적 예산·재시도·승인 경계 시뮬레이션은
`npm run test:soak`으로 반복 검증한다. 이 검증은 실제 API 품질 검증을 대체하지 않는다.

## 선택형 멀티에이전트 orchestration

L5 멀티에이전트는 별도의 명시적 opt-in이다. `HARNESS_AUTONOMY_LEVEL=5`만으로 활성화되지 않으며, 프로젝트의 `multi_agent.enabled=true` 설정과 명시적인 `orchestrate` 실행이 모두 필요하다. 비활성화 상태에서는 기존 단일 에이전트 L5 루프가 유지된다.

Provider API 역할 호출은 orchestration run 전체에서 `HARNESS_MAX_API_CALLS`와 `HARNESS_MAX_PROVIDER_REQUESTS` 중 더 작은 한도를 공유한다. 호출 실패도 예산에 포함하며, `HARNESS_MAX_RUNTIME_MINUTES` deadline 이후에는 상태 조회와 복구 진단을 제외한 진행 명령을 차단한다.

```bash
npm run harness -- orchestrate <ticket> --mode auto --max-workers 2
```

실행 모드는 다음 세 가지다.

- `interactive native`: host adapter가 실제 하위 에이전트를 생성하고, 하네스가 계획·artifact·체크포인트·승인 상태를 관리한다.
- `API managed`: orchestrator가 역할별 provider 요청을 실행하며 기존 L5 API 예산과 재시도 한도를 공유한다.
- `sequential fallback`: delegation 또는 parallel capability가 없을 때 호스트가 역할 요청을 하나씩 수행하고 artifact를 기록한 뒤 다음 역할로 진행한다.

### Phase 1: single writer

Planner와 Architect, Reviewer와 Verifier는 독립적인 경우 병렬 실행할 수 있다. Orchestrator가 분석 artifact를 정규화하고 계획을 고정한 뒤, workspace 변경은 하나의 Implementer만 수행한다. Reviewer와 Verifier는 Implementer와 분리한다.

### Phase 2: isolated worktree multi-writer

여러 Implementer는 별도 opt-in이며 다음 조건을 모두 만족해야 한다.

- worker별 `owned_paths`가 겹치지 않는다.
- 동일한 `base_commit`에서 시작한다.
- `.worktrees/orchestrate/<run-id>/` 아래에 worker별 branch/worktree를 사용한다.
- manifest, lockfile, DB migration, CI, scripts, 인프라, 보안 정책은 병렬 writer 대상에서 제외한다.
- worker commit SHA, diff hash, 소유 경로와 worker-level 검증 결과를 통합 전에 다시 확인한다.

통합은 별도 integration branch/worktree에서 수행한다. stale base, 소유 경로 이탈, 검증 실패 또는 충돌은 자동 해결하거나 강제 병합하지 않고 중단한다.

### 예산과 복구

모든 역할 호출은 `HARNESS_MAX_API_CALLS`, `HARNESS_MAX_PROVIDER_REQUESTS`, `HARNESS_MAX_RUNTIME_MINUTES`에 합산한다. 일부 역할이 실패하면 성공 artifact는 보존하고 실패 역할만 재시도할 수 있다.

```bash
npm run harness -- orchestrate --status <run-id>
npm run harness -- orchestrate --resume <run-id>
npm run harness -- orchestrate --begin-review <run-id>
npm run harness -- orchestrate --finish <run-id>
```

중단 상태는 비파괴적으로 진단한다. 다른 worker의 branch/worktree나 사용자가 만든 파일을 삭제하지 않으며, `git reset --hard`, `git clean -fd`, 강제 push로 복구하지 않는다.

## 승인 경계

다음 변경은 패치를 저장한 뒤 `approval_required` 상태로 멈춘다.

- CI와 GitHub Actions
- dependency manifest와 lockfile
- build 설정
- scripts
- 배포, 인프라, Kubernetes, Helm, Terraform
- DB migration
- 인증, 권한, 보안 정책 완화
- secret 접근 또는 비용이 발생하는 외부 API 추가
- 파일 삭제와 이름 변경
- worker 결과 통합, commit, push, PR merge
- 역할 사이에서 충돌하는 고위험 제안

패치를 직접 검토한 뒤에만 재개한다.

```bash
npm run harness -- autonomy --approve-risk
npm run harness -- orchestrate --approve <run-id>
npm run harness -- orchestrate --integrate <run-id> --approve-risk
npm run harness -- orchestrate --promote <run-id> --approve-risk
```

`--approve-risk`는 보호 경로와 비밀값 금지를 해제하지 않는다.
하위 에이전트는 승인을 요청할 수 있지만 승인 상태를 직접 변경할 수 없다.

멀티에이전트 통합 뒤에는 integration branch에서 `verify --full`을 새로 실행해야 한다.
worker별 검증, `verify --quick`, 통합 전 Full 결과는 완료 권한을 부여하지 않으며,
현재 통합 콘텐츠와 일치하는 `last_full` 성공 지문이 없으면 `complete-task`를 실행할 수 없다.

## 자동 커밋과 푸시

```env
HARNESS_AUTO_COMMIT=false
HARNESS_AUTO_PUSH=false
```

둘 다 기본 비활성화다. `HARNESS_AUTO_COMMIT=true`는 main/master에서 거부된다.
`HARNESS_AUTO_PUSH=true`는 자동 커밋이 성공한 task branch에서만 의미가 있다.

## 상태 확인

```bash
npm run harness -- autonomy --status
```

체크포인트는 `observability/autonomy/state.json`에 기록되며 Git에는 포함되지 않는다.

## 장시간 실행 복구

패치 적용 전 현재 HEAD, 티켓, 패치 경로와 작업 트리 상태를 체크포인트에 기록한다.
적용 또는 역적용이 실패해도 `git reset --hard`나 `git clean -fd`는 자동 실행하지 않는다.
대신 `apply_failed` 또는 `rollback_failed` 상태와 비파괴 복구 명령을 남기고 중단한다.

API 재시도 설정:

```env
HARNESS_API_MAX_RETRIES=3
HARNESS_API_RETRY_BASE_MS=1000
HARNESS_API_RETRY_MAX_MS=30000
HARNESS_MAX_PROVIDER_REQUESTS=12
```

인증 오류, 잘못된 요청, quota 소진처럼 재시도로 해결되지 않는 응답은 즉시 중단한다.

## 중단 후 복구 진단

토큰 만료, 터미널 종료, 네트워크 단절, PC 재시작 뒤에는 먼저 읽기 전용 복구 진단을 실행한다.

```bash
npm run harness -- recover
```

`recover`는 active 티켓, autonomy 체크포인트, 현재 HEAD, 작업 트리, 마지막 verify 콘텐츠 지문을 대조한다.

- `retry_agent`: 공급자 호출 전에 멈췄고 구현 변경이 없어 같은 티켓을 다시 시도할 수 있다.
- `retry_patch`: 패치 적용 직전 체크포인트와 작업 트리가 같아 패치 적용을 다시 시도할 수 있다.
- `inspect_partial_patch`: 패치 적용 도중 멈춘 흔적이 있어 diff를 먼저 확인해야 한다.
- `inspect_and_verify`: 미검증 구현 변경이 남아 있으므로 보존한 채 검토하고 verify해야 한다.
- `fix_and_reverify`: 마지막 verify 실패 원인을 확인해 수정하고 다시 검증해야 한다.
- `reverify_required`: 마지막 verify 뒤 콘텐츠가 변경됐다.
- `ready_to_complete`: 현재 콘텐츠가 마지막 verify 통과 지문과 일치한다.
- `approval_required`, `manual_review`: 승인 또는 사람의 판단 없이는 진행하지 않는다.

복구 진단은 `git reset --hard`, `git clean -fd`, 자동 파일 삭제를 수행하지 않는다.
