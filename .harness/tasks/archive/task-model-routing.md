# TICKET: task-model-routing

## Type
feat

## Goal
- 업무 난이도·중요도·재시도 기반 결정론적 모델 라우팅 및 최신 기본 모델 갱신

## Scope
- tools/harness-cli/model-router.js, tools/harness-cli/index.js, tools/harness-cli/agent-runner.js, .env.template, tests/harness-cli/model-router.test.js

## Out of Scope
- 추가 LLM 호출을 통한 라우팅, 외부 과금 API 변경, 무단 Git 커밋/푸시

## Acceptance Criteria
- [x] 업무 유형·중요도·위험도·재시도 횟수 기반 fast/standard/strong 티어 선택
- [x] 실패 재시도 시 상위 모델 자동 승격 (fast → standard → strong)
- [x] 최신 3사 모델 기본값(OpenAI gpt-6-luna/gpt-6.1-sol/gpt-6-astra, Anthropic claude-haiku-5-5/claude-sonnet-5-5/claude-opus-5-5, Gemini gemini-3.5-flash-lite/gemini-3.8-flash/gemini-4-argon) 반영 및 단위 테스트 통과

## Risk
- 낮음

## Verification Evidence
- Full verify (`node tools/harness-cli/index.js verify --full`): coverage thresholds, ESLint, and guardrails passed on Windows.
- Test suite (`node tests/harness-cli/run.js`): 332 passed, 0 failed, 0 skipped.
- Environment drift check (`node tools/harness-cli/index.js scan-drift`): passed with zero drift.

## Completion
- Completed At: 2026-11-03T01:35:07Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
