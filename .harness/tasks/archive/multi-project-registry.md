# TICKET: multi-project-registry

## Type
feat

## Goal
- 중앙 하네스에 여러 Git 프로젝트를 안전하게 등록하고 조회·진단한다

## Scope
- 프로젝트 레지스트리 스키마, add/list/show/remove/check 명령, 경로·Git 검증

## Out of Scope
- 자연어 티켓 분해와 작업 실행

## Acceptance Criteria
- [x] Windows·macOS·Linux 절대 경로를 지원한다
- [x] 프로젝트 로컬 경로를 `.harness/local/projects.json`에 저장하고 Git에서 제외한다
- [x] `project add/list/show/check/remove`로 등록과 읽기 전용 Git 진단을 수행한다
- [x] 등록 시 기술 스택과 권장 검증 명령을 감지한다
- [x] 대상 프로젝트의 기존 파일과 미커밋 변경을 수정하지 않는다

## Risk
- 중간

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:25:34Z
- Verify Result: pass
- Rework Count: 1
- Last Failure: Node coverage: ERROR: Coverage for branches (71.15%) does not meet global threshold (73%)
