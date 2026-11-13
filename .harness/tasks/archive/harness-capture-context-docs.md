# TICKET: harness-capture-context-docs

## Type
feat

## Goal
- 루트 Markdown 로드맵/태스크 문서(.md) 컨텍스트 참조 및 프로젝트 컨텍스트 발견 보강

## Scope
- context-references.js 및 project-context.js에서 안전한 프로젝트 루트 .md(task.md/ROADMAP.md/PLANS.md 등) 허용 및 탐색 지원

## Out of Scope
- 외부 URL, symlink/junction, 숨김 파일(.env 등), .md 외 임의 파일 허용

## Acceptance Criteria
- [ ] 루트 .md 컨텍스트 참조 검증/차단 규칙 유지 및 관련 단위 테스트 통과

## Risk
- low

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-11-13T13:07:16Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
