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

## 1. 절대 원칙 (3가지만)

1. **master 브랜치 직접 수정 금지** — `bash scripts/start-task.sh <task> <type>`으로만 작업
2. **커밋 전 검증 필수** — `bash scripts/verify-task.sh` 통과 후에만 커밋
3. **고위험 결정은 슬랙 승인** — DB 스키마 변경, 인프라 변경은 자동 실행 금지

---

## 2. 작업 루프 (5단계)

```
[1] PLANS.md 읽고 목표 파악
[2] start-task.sh → 워크트리 + EXEC_PLAN 생성
[3] 워크트리에서 구현 (core-beliefs.md + tech-stack.md 준수)
[4] verify-task.sh → 테스트 + 린트 + 빌드 통과
[5] git commit → complete-task.sh
```

---

## 3. 세부 문서 링크

| 문서 | 내용 |
|------|------|
| `docs/design-docs/core-beliefs.md` | 아키텍처 원칙, 코딩 규칙, 안전 가드레일 |
| `docs/design-docs/tech-stack.md` | 기본 기술 스택 (PLANS.md에서 override 가능) |
| `docs/skills/code-review.md` | 코드 리뷰 수행 방법 |
| `docs/skills/git-workflow.md` | Git 컨벤션 및 커밋 규칙 |
| `docs/adr/` | 아키텍처 결정 기록 |
| `docs/project/PLANS.md` | 프로젝트 목표 및 로드맵 |
