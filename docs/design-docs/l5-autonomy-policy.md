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

## 승인 경계

다음 변경은 패치를 저장한 뒤 `approval_required` 상태로 멈춘다.

- CI와 GitHub Actions
- dependency manifest와 lockfile
- build 설정
- scripts
- 배포, 인프라, Kubernetes, Helm, Terraform
- DB migration

패치를 직접 검토한 뒤에만 재개한다.

```bash
npm run harness -- autonomy --approve-risk
```

`--approve-risk`는 보호 경로와 비밀값 금지를 해제하지 않는다.

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
