# TICKET: managed-release-git-gate

## Type
feat

## Goal
- 승인 지문에 결속된 일회성 권한으로만 commit, push, merge Git 작업을 실행한다.

## Scope
- release request에 Git 작업과 고정 인자를 포함
- apply 직전 worktree 지문, branch, 승인 상태 재검증
- 승인 일회성 소비 및 실행 결과 감사 기록
- L5 auto-commit 우회 경로 제거

## Out of Scope
- 호스팅 서비스의 PR 생성 및 보호 브랜치 설정 변경

## Acceptance Criteria
- [x] 승인 전 또는 승인 지문 불일치 시 Git 변경 작업이 실행되지 않는다
- [x] 승인된 작업과 다른 commit/push/merge 인자를 런타임에 바꿀 수 없다
- [x] 승인된 worktree가 변경되면 apply가 차단된다
- [x] 소비된 승인은 재사용할 수 없고 결과가 상태에 기록된다
- [x] L5는 사용자 승인 없이 자동 commit/push하지 않는다

## Risk
- high

## Notes
- Created from harness CLI.
- Implementation and regression tests are ready for full verification and commit approval.
