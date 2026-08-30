# TICKET: project-context-trust-boundary

## Type
feat

## Goal
- 등록 프로젝트 컨텍스트의 프롬프트 인젝션과 정책 우회를 차단한다

## Scope
- 신뢰 등급, 정책 우선순위, 도구/비밀 권한 경계, 위험 지시 탐지, 테스트

## Out of Scope
- 외부 보안 제품 연동

## Acceptance Criteria
- [x] 프로젝트 문서가 중앙 정책 변경이나 비밀 접근을 지시해도 실행 권한에 반영되지 않는다
- [x] 모든 프로젝트 문서는 명시적인 untrusted 경계 안에서만 에이전트 프롬프트에 포함된다
- [x] 정책 우회, 비밀 접근, 도구 권한 상승 지시는 구조화된 위험 항목으로 표시된다

## Risk
- high

## Notes
- Created from harness CLI.
- Implementation and regression tests are ready for full verification and commit approval.
