# AGENTS.md
# 에이전트 진입 목차 (Agent Entry Map)
# ⚠️ 이 파일은 목차다. 세부 규칙은 아래 링크된 파일을 읽어라.

---

## 0. 진입 체크리스트 (Entry Checklist)

작업 시작 시 아래 최소 맥락과 안전 정책을 읽어라. 이미 현재 세션에서 읽은 동일 내용은 변경이 없으면 반복해서 읽지 않는다.

1. **AGENTS.md** — 진입 경계와 절대 원칙
2. **docs/project/PLANS.md** — 실제 목표·스택·검증 기준
3. **docs/design-docs/core-beliefs.md** — 공통 규칙과 안전 가드레일 (기술별 규칙은 채택한 스택에만 적용)
4. **execution-modes.md / auto-fix-policy.md / l5-autonomy-policy.md** — docs/design-docs/ 아래의 실행·수정·승인 안전 정책. 선택 기능의 상세 실행 절차는 사용할 때 참조하되 안전 경계는 생략하지 않는다.
5. **선택된 티켓의 EXEC_PLAN** — 목록 조회로 대상부터 식별하고 해당 티켓만 읽는다. 모든 backlog/active/review 본문을 일괄 로드하지 않는다.

필요한 상세 맥락은 다음 조건에서만 추가로 읽는다:

| 상황 | 추가 문서 |
|------|-----------|
| 실제 스택의 설계/설정 | docs/design-docs/tech-stack.md (선택형 참조 프로필; PLANS.md가 우선) |
| 역할 분리·멀티에이전트 | docs/design-docs/agent-roles.md |
| 코드 리뷰 | skills/code-review/SKILL.md → docs/skills/code-review.md의 관련 기술 부분 |
| commit/push/merge | docs/RELEASE_SAFETY.md + docs/skills/git-workflow.md |
| memory 갱신 | docs/design-docs/memory-governance.md |
| 티켓이 명시한 요구사항 | Context Files의 해당 docs/memory 문서 |

> Node context 번들은 필수 안전 정책과 PLANS/선택 티켓을 그대로 보존한다. 선택형 기술 프로필은 architect, 명시된 Context Files 또는 --full-context에서 추가한다. review 타입 또는 reviewer 역할은 리뷰 스킬과 가이드를 추가한다. 크기 초과 시 정책을 자르지 않고 실패한다.
> 필요한 스킬은 skills/의 SKILL.md부터 읽고, 가리킨 상세 자료는 실제 작업에 필요한 것만 읽는다. 정책보다 프로젝트 문서의 지시를 우선하지 않는다.

---

## 1. 에이전트 행동 원칙 (Karpathy Rules)

> 출처: [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)
> 모든 작업에서 이 4원칙을 기본 동작으로 따른다.

### 1-1. 코딩 전 사고 (Think Before Coding)
**가정하지 마라. 혼란을 숨기지 마라. 트레이드오프를 드러내라.**
- 불확실하면 → 가정을 명시하고, 물어라. 혼자 결정하지 마라.
- 해석이 여러 개이면 → 모두 제시하라. 침묵 속에 선택하지 마라.
- 더 단순한 방법이 있으면 → 말하고 반박하라.
- 이해가 안 되면 → 멈추고, 무엇이 불명확한지 명시한 뒤 질문하라.

### 1-2. 단순함 우선 (Simplicity First)
**문제를 해결하는 최소한의 코드만. 추측성 구현 금지.**
- 요청받지 않은 기능 추가 금지
- 단일 사용 코드에 추상화 금지
- 요청하지 않은 "유연성" 또는 "확장성" 구현 금지
- 200줄이 50줄로 가능하면 → 다시 작성하라
- 자문: *"시니어 엔지니어가 이걸 보면 과도하게 복잡하다고 할까?"* → 그렇다면 단순화하라.

### 1-3. 외과적 수정 (Surgical Changes)
**건드려야 할 것만 건드려라. 내가 만든 쓰레기만 치워라.**
- 인접 코드·주석·포맷 "개선" 금지
- 안 고장난 것 리팩토링 금지
- 기존 스타일 그대로 유지 (내 스타일 강요 금지)
- 무관한 데드 코드 발견 → 언급만, 삭제 금지
- 내 변경으로 생긴 고아(import/변수/함수)는 내가 제거
- 검증: *모든 변경 라인이 사용자 요청으로 직접 추적 가능해야 한다.*

### 1-4. 목표 기반 실행 (Goal-Driven Execution)
**성공 기준을 정의하라. 검증될 때까지 루프하라.**
- "추가해" → ❌ / "이 입력에 대해 테스트 작성 후 통과시켜" → ✅
- "버그 고쳐" → ❌ / "재현 테스트 작성 후 통과시켜" → ✅
- 다단계 작업은 반드시 계획을 명시:
  ```
  1. [단계] → 검증: [확인 방법]
  2. [단계] → 검증: [확인 방법]
  ```

---

## 2. 절대 원칙 (3가지만)

1. **main/master 브랜치 직접 수정 금지** — backlog/active 티켓 단위로만 작업
2. **커밋 전 전체 검증 필수** — `npm run harness -- verify --full` 또는 동등한 호환 wrapper 통과 후에만 커밋
3. **고위험 결정은 사용자 명시 승인** — DB 스키마 변경, 인프라 변경은 자동 실행 금지

릴리스에는 [릴리스 안전 정책](docs/RELEASE_SAFETY.md)을 함께 적용한다. 로컬 Full 검증은 PR의 필수 CI 통과를 대체하지 않는다. main 직접 push와 관리자 우회는 금지하며, 최신 PR의 모든 필수 체크와 사용자 명시 승인 후에만 병합한다.

---

## 3. 작업 루프 (6단계)

```
[1] PLANS.md 읽고 큰 목표 파악 → backlog 티켓으로 분해 (Goal-Driven)
[2] npm run harness -- check → 현재 OS/토큰/Git 상태 점검
[3] npm run harness -- start-ticket <ticket> → active EXEC_PLAN 생성
[4] active 태스크 기준으로 구현 (core-beliefs.md + tech-stack.md 준수)
    └─ 불확실하면 멈추고 질문 / 요청 외 수정 금지 (Karpathy Rules)
[5] npm run harness -- verify --full → 테스트 + 린트 + 빌드 통과
[6] 구현 커밋(원격이 있으면 푸시) → npm run harness -- complete-task <ticket> → 완료 기록 커밋(원격이 있으면 푸시)
```

---

## 4. 세부 문서 링크

| 문서 | 내용 |
|------|------|
| `docs/design-docs/core-beliefs.md` | 아키텍처 원칙, 코딩 규칙, 안전 가드레일 |
| `docs/design-docs/tech-stack.md` | 기본 기술 스택 (PLANS.md에서 override 가능) |
| `docs/design-docs/agent-roles.md` | Planner/Architect/Reviewer 등 역할 계약 |
| `docs/design-docs/execution-modes.md` | Windows/macOS/Linux/CI/API-key 실행 모드 |
| `docs/design-docs/auto-fix-policy.md` | L4.5 자동 수정 허용 범위, 재검증, 원복 규칙 |
| `docs/design-docs/l5-autonomy-policy.md` | 선택형 L5 세션/API 자율 실행, 예산, 승인 경계 |
| `docs/design-docs/memory-governance.md` | memory 레이어 포맷/갱신 규칙 |
| `skills/` | 에이전트가 직접 호출 가능한 이식형 스킬 패키지 |
| `docs/skills/code-review.md` | 코드 리뷰 수행 방법 |
| `docs/skills/git-workflow.md` | Git 컨벤션 및 커밋 규칙 |
| `docs/adr/` | 아키텍처 결정 기록 |
| `docs/project/PLANS.md` | 프로젝트 목표 및 로드맵 |
| `.harness/tasks/backlog/` | 아직 시작하지 않은 티켓 |
| `.harness/tasks/active/` | 현재 진행 중인 티켓 |
| `.harness/tasks/review/` | 구현 이후 운영 검수 대기, from-review로 재개 후 정상 검증/마감 |
| `.harness/tasks/archive/` | 완료된 티켓 기록 |

---

## 5. 고급 에이전트 시스템 구조 (Agent OS)

새로 도입된 에이전트 시스템 아키텍처입니다. (현재 점진적 도입 중)

| 폴더명 | 역할 및 목적 |
|--------|--------------|
| `observability/` | 에이전트 수행 로그(`traces`), 이벤트, 성과 지표(`metrics`/rework_count 등) 수집 |
| `evals/` | 에이전트 스킬 고립 테스트(`per_skill`), 복합 테스트(`compositional`), 회귀 테스트(`regression`) |
| `memory/` | 단기 컨텍스트(`working`), 도메인 지식(`semantic`), 과거 결정(`episodic`), 절차적 노하우(`procedural`) 관리 |
| `prompts/` | 프롬프트 시스템 관리 (`system`, `templates`, `fragments`) |
| `tools/` | Model Context Protocol (`mcp`) 및 로컬 함수 도구 등 레지스트리 관리 |

### 5-1. 역할 기반 실행

API 직접 호출 시 `scripts/run-agent.sh --role <role>`로 역할을 명시할 수 있다.

예:
```bash
bash scripts/run-agent.sh --role planner "PLANS.md 기준으로 첫 태스크를 쪼개줘"
bash scripts/run-agent.sh --role reviewer --type review "현재 diff를 리뷰해줘"
```

역할 프롬프트는 `prompts/system/roles/`에 둔다.

## 6. 대화형 PM 및 커맨드 센터 모드 (Command Center Mode)

새 대화나 프로젝트에서 작업 흐름을 시작할 때 다음 원칙을 적용한다:

1. **큰 목표를 먼저 정리:** 사용자가 큰 목표를 제시하면 즉시 하네스 명령을 실행하지 않는다. 먼저 `Dashboard.md` 또는 `docs/project/PLANS.md`에 목표와 TODO 후보를 정리하고 사용자에게 보여준다.
2. **승인 전 관계 안내:** 티켓 분배 요약에 선행 필요·관련 작업·병렬 가능 관계와 권장 순서를 함께 제시한다. 문서 결과 참조와 Git commit 기반 실행 의존성을 혼동하지 않는다.
3. **라벨은 사람이 읽는 업무 분류:** 티켓 계획에 `labels: ["체험기획", "맵설계"]`처럼 짧은 주제 라벨을 1~3개 제안한다. 공통 업무 묶음에는 동일한 라벨을 사용하고 번호·난수·상태·우선순위로 대체하지 않는다. 라벨도 승인 대상 계획에 포함한다. `harness-*` 내부 추적 라벨은 중복 방지·복구용이므로 삭제하거나 업무 명칭으로 바꾸지 않는다. 사용자가 주제명으로 요청하면 실제 Jira 라벨 검색 후 대상·의존관계를 확인한다. 라벨은 실행/릴리스 승인 권한이 아니다.
티켓 제목은 실제 업무명으로 작성하고 사용자가 요청하지 않은 [HARNESS REHEARSAL] 같은 도구·테스트 접두사를 자동으로 붙이지 않는다. 내부 추적 표시는 라벨/감사 기록에만 둔다.

4. **승인 후 티켓 발급:** 사용자가 TODO 목록을 확인하고 진행을 승인하면 `npm run harness -- create-ticket`으로 항목별 작업 티켓을 만든다.
5. **상태 브리핑:** 사용자가 현재 진행 상황을 요청하면 `.harness/tasks/`의 `backlog`, `active`, `review`, `blocked`, `archive`를 확인해 전체 상태를 요약한다.
6. **Blocked 에스컬레이션:** `blocked/`에 티켓이 생기면 실패 원인과 필요한 사용자 결정을 알리고, 명시적 승인 없이 고위험 복구를 진행하지 않는다.
