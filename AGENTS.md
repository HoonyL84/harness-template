# AGENTS.md
# 에이전트 진입 목차 (Agent Entry Map)
# ⚠️ 이 파일은 목차다. 세부 규칙은 아래 링크된 파일을 읽어라.

---

## 0. 진입 체크리스트 (Entry Checklist)

작업 시작 전 반드시 순서대로 읽어라:

1. **이 파일 (AGENTS.md)** — 목차 및 절대 원칙
2. **`docs/project/PLANS.md`** — 현재 프로젝트 목표, 로드맵, 기술 스택
3. **`docs/design-docs/core-beliefs.md`** — 아키텍처 핵심 신념 및 코딩 규칙
4. **`docs/design-docs/tech-stack.md`** — 기본 기술 스택 및 설정
5. **`.harness/tasks/active/`** — 현재 진행 중인 태스크의 EXEC_PLAN

> 필요한 스킬이 있으면 `docs/skills/`를 탐색하라.

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

1. **master 브랜치 직접 수정 금지** — `bash scripts/start-task.sh <task> <type>`으로만 작업
2. **커밋 전 검증 필수** — `bash scripts/verify-task.sh` 통과 후에만 커밋
3. **고위험 결정은 슬랙 승인** — DB 스키마 변경, 인프라 변경은 자동 실행 금지

---

## 3. 작업 루프 (5단계)

```
[1] PLANS.md 읽고 목표 파악 → 성공 기준 명시 (Goal-Driven)
[2] start-task.sh → 워크트리 + EXEC_PLAN 생성
[3] 워크트리에서 구현 (core-beliefs.md + tech-stack.md 준수)
    └─ 불확실하면 멈추고 질문 / 요청 외 수정 금지 (Karpathy Rules)
[4] verify-task.sh → 테스트 + 린트 + 빌드 통과
[5] git commit → complete-task.sh
```

---

## 4. 세부 문서 링크

| 문서 | 내용 |
|------|------|
| `docs/design-docs/core-beliefs.md` | 아키텍처 원칙, 코딩 규칙, 안전 가드레일 |
| `docs/design-docs/tech-stack.md` | 기본 기술 스택 (PLANS.md에서 override 가능) |
| `docs/skills/code-review.md` | 코드 리뷰 수행 방법 |
| `docs/skills/git-workflow.md` | Git 컨벤션 및 커밋 규칙 |
| `docs/adr/` | 아키텍처 결정 기록 |
| `docs/project/PLANS.md` | 프로젝트 목표 및 로드맵 |
