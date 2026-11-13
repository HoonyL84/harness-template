# TICKET: harness-pr-merge-execution-archive

## Type
feat

## Goal
- 외부 PR 머지 근거 기반 execution 완료 마감(complete) 및 아카이브 지원

## Scope
- execution complete <id> 명령 추가: REVIEW_READY 티켓의 외부 PR/커밋 근거를 기록하고 execution 상태를 COMPLETED로 마감

## Out of Scope
- 사용자 승인 없는 자동 git merge/push 실행

## Acceptance Criteria
- [ ] 명시적 근거 없이 미검증 티켓을 마감할 수 없고, 근거 포함 마감 시 상태 전이 및 단위 테스트 통과

## Risk
- medium

## Notes
- Created from harness CLI.
