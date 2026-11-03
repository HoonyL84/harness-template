# TICKET: cli-help-and-modularization

## Type
refactor

## Goal
- CLI 도움말 역할별 계층화 및 엔트리포인트 라우팅 연결

## Scope
- tools/harness-cli/index.js, tests/harness-cli/run.js

## Out of Scope
- 기존 CLI 명령어 호환성 파괴

## Acceptance Criteria
- [x] `usage()` 도움말을 4개 논리 섹션(`[Multi-Project Control Plane]`, `[Single-Repo Mode]`, `[Integrations & Recovery]`, `[Evals, Provider & Diagnostics]`)으로 구조화
- [x] `--model-tier` 및 `skill-eval.js --skill` 안내 반영 및 전체 회귀 테스트 통과

## Risk
- 낮음

## Verification Evidence
- `node --test tests/harness-cli/cli-entrypoint.test.js tests/harness-cli/cli-process.test.js` 통과.
- 전체 테스트 스위트 332개 통과 (`fail 0`, `skipped 0`).

## Completion
- Completed At: 2026-11-03T01:34:00Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
