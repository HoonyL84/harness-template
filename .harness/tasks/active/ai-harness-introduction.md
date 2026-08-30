# TICKET: ai-harness-introduction

## Type
docs

## Goal
- 다른 AI가 하네스의 구현 기능, 사용 흐름, 안전 경계와 한계를 팩트 기반으로 이해하는 소개 문서를 작성한다

## Scope
- [x] 하네스의 목적과 해결하려는 문제를 현재 PLANS 기준으로 설명한다.
- [x] 실제 CLI에 구현된 프로젝트 등록, Bootstrap, 요청 승인, 실행, 검증, 릴리스와 evidence 흐름을 설명한다.
- [x] 실행 모드별 지원 수준과 멀티에이전트의 실제 활성화 조건을 구분한다.
- [x] 안전 정책과 현재 보장하지 않는 범위를 명시한다.
- [x] 다른 AI가 바로 사용할 수 있는 작업 순서와 짧은 전달문을 제공한다.

## Out of Scope
- 기능 구현 또는 설정 변경
- 특정 AI provider나 모델의 성능 보증
- 마케팅용 등급 또는 검증되지 않은 완성도 주장

## Acceptance Criteria
- [x] 각 핵심 주장에 대응하는 저장소 원본 문서 또는 코드 경로가 제시된다.
- [x] 구현됨, 제한적 지원, Experimental과 비지원 범위가 구분된다.
- [x] 사용자 승인 전 commit, push, merge 금지 원칙과 raw Git 통제 한계가 함께 설명된다.
- [x] 문서 공백 검사, lint, coverage와 Harness Full 검증이 통과한다.

## Risk
- 낮음

## Notes
- Created from harness CLI.
