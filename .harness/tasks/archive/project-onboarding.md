# TICKET: project-onboarding

## Type
feat

## Goal
- 하네스가 없는 등록 프로젝트의 로컬 실행 프로필을 생성하고 승인 상태를 관리한다

## Scope
- 등록 저장소 분석, 로컬 실행 프로필 생성, 지문 기반 승인과 드리프트 차단

## Out of Scope
- 자연어 요청 분해와 worktree 생성

## Acceptance Criteria
- [x] 하네스 파일이 없는 Git 프로젝트도 원본 수정 없이 프로필을 생성한다
- [x] HEAD·브랜치·원격·dirty 상태·스택·검증·컨텍스트를 기록한다
- [x] 프로필은 Git 제외 로컬 경로에 원자적으로 저장한다
- [x] 생성 후 변경된 프로필과 프로젝트 상태는 승인을 차단한다
- [x] 승인 프로필은 격리 worktree와 커밋 승인 정책을 강제한다

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:25:45Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
