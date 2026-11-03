# TICKET: agent-os-scaffolding-sync

## Type
chore

## Goal
- 초기 스캐폴딩 폴더(memory, tools, evals)와 실제 제어면 정합성 및 memory frontmatter 검증 연결

## Scope
- tools/harness-cli/memory-governance.js, AGENTS.md, tools/registry.yaml, evals/compositional/README.md, tests/harness-cli/memory-governance.test.js

## Out of Scope
- 자동 메모리 생성/삭제, 외부 DB 연동

## Acceptance Criteria
- [x] `memory/{working,semantic,episodic,procedural}/*.md` frontmatter 및 레이어 일치 검증 유틸리티 구현
- [x] 심볼릭 링크/정션 차단 및 단위 테스트 통과
- [x] `AGENTS.md`, `tools/registry.yaml`, `evals/compositional/README.md`와 실제 CLI 컨트롤 플레인 정합성 확보

## Risk
- 낮음

## Verification Evidence
- `node --test tests/harness-cli/memory-governance.test.js` 통과.
- 전체 테스트 스위트 332개 통과 (`fail 0`, `skipped 0`).

## Completion
- Completed At: 2026-11-03T01:34:00Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
