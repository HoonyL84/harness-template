# TICKET: harness-main-advance-execution-sync

## Type
feat

## Goal
- 실행 중 main 선행 머지 시 PREPARED/WAITING_DEPENDENCY 티켓의 안전 동기화(sync-base) 지원

## Scope
- execution sync-base(또는 rebase) 경로 추가: clean WORKTREE/ancestor 조건에서 base_commit 및 profile 스냅샷 안전 갱신

## Out of Scope
- dirty worktree 강제 덮어쓰기 또는 merge conflict 자동 해소

## Acceptance Criteria
- [ ] main 전진 시 waiting/prepared 티켓이 안전하게 동기화·검증되고 기존 snapshot/fingerprint 가드가 유지됨

## Risk
- medium

## Notes
- Created from harness CLI.
