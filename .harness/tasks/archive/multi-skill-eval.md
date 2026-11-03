# TICKET: multi-skill-eval

## Type
feat

## Goal
- 범용 스킬 레지스트리 및 다중 스킬 평가(--skill) 확장

## Scope
- tools/harness-cli/skill-eval.js, tests/harness-cli/skill-eval.test.js, evals/per_skill/README.md

## Out of Scope
- 외부 네트워크 호출, 의미적 정답 자동 판정

## Acceptance Criteria
- [x] `--skill <skill-name>` 및 `--list-skills` 옵션 지원 (기본값 `code-review` 하위 호환 유지)
- [x] 스킬 이름 정규식 검증 및 심볼릭 링크/정션(`junction`) 우회 차단
- [x] 다중 스킬 로딩 및 오라클 회귀 테스트 통과

## Risk
- 낮음

## Verification Evidence
- `node --test tests/harness-cli/skill-eval.test.js tests/harness-cli/lean-workflow.test.js` 통과.
- 전체 테스트 스위트 332개 통과 (`fail 0`, `skipped 0`).

## Completion
- Completed At: 2026-11-03T01:34:00Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
