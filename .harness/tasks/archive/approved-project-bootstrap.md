# TICKET: approved-project-bootstrap

## Type
feat

## Goal
- 승인된 초기 계획을 최초 Git 기준 커밋으로 만들고 신규 프로젝트를 자동 등록한다

## Scope
- [x] 기존 Git HEAD 유무를 자동 판정한다.
- [x] 최초 커밋이 없는 저장소의 파일 스냅샷과 계획 승인 지문을 결속한다.
- [x] 비밀 파일, ignored 파일, symlink/junction, 대용량 바이너리를 최초 커밋에서 차단한다.
- [x] 사용자가 승인한 계획을 일회성으로 적용해 최초 커밋, 프로젝트 등록, onboarding 초안을 생성한다.
- [x] 기존 HEAD가 있는 저장소는 최초 커밋 없이 일반 등록 흐름으로 전환한다.

## Out of Scope
- 원격 저장소 생성 및 push
- 제품 코드 자동 생성
- 승인 없는 최초 커밋

## Acceptance Criteria
- [x] 신규 저장소 계획 승인 전에는 Git commit이 실행되지 않는다.
- [x] 승인 후 파일 내용이 바뀌면 최초 커밋이 거부된다.
- [x] 기존 저장소는 bootstrap commit 없이 등록된다.
- [x] 최초 커밋 뒤 중앙 레지스트리와 DRAFT onboarding profile이 생성된다.
- [x] 승인 재사용이 차단된다.

## Risk
- 높음: Git 최초 커밋과 파일 staging을 수행하므로 fail-closed 검증이 필요하다.

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T13:21:50Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
