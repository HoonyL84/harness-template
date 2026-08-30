# TICKET: project-context-management

## Type
feat

## Goal
- 등록 프로젝트별 배경지식을 안전하게 탐색하고 격리된 컨텍스트 번들을 생성한다

## Scope
- 프로젝트별 지침·계획·active 티켓·설계·ADR·memory 자동 탐색과 컨텍스트 번들 생성

## Out of Scope
- 자연어 요청 분해, 프로젝트 파일 자동 갱신, 작업 실행

## Acceptance Criteria
- [x] 알려진 Markdown 컨텍스트만 우선순위대로 탐색한다
- [x] `.env`와 임의 파일을 제외하고 프로젝트 루트 밖의 경로를 차단한다
- [x] 최대 파일 수와 바이트 예산으로 컨텍스트 크기를 제한한다
- [x] 프로젝트 문서 변경을 재등록 없이 다음 호출에 반영한다
- [x] 대상 프로젝트를 수정하지 않고 컨텍스트 요약과 번들을 제공한다

## Risk
- 낮음

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-30T00:25:39Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
