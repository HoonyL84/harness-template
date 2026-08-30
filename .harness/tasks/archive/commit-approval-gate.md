# TICKET: commit-approval-gate

## Type
feat

## Goal
- 사용자 명시 승인 전 commit·push·merge를 기술적으로 차단한다

## Scope
- 승인 요청, 일회성 승인 기록, 콘텐츠 지문, Git 명령 게이트, 감사 로그

## Out of Scope
- 호스팅 서비스별 PR 병합 UI 자동화

## Acceptance Criteria
- [x] REVIEW_READY 콘텐츠 지문과 일치하는 일회성 승인만 소비할 수 있고 변경·재사용을 차단한다

## Risk
- 중간

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:26:03Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
