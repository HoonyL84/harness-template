# TICKET: provider-usage

## Type
feat

## Goal
- Provider 전환과 하네스 관측 토큰 사용량 및 잔여 예산 조회를 추가한다

## Scope
- Provider별 활성 설정을 `.harness/local/`의 로컬 상태로 전환한다.
- 하네스 API 응답의 토큰 메타데이터를 Provider별·월별로 기록한다.
- 설정 여부, 관측 사용량, 월 토큰 예산과 잔여량을 CLI와 JSON으로 조회한다.
- API 키 값은 출력·로그·사용량 상태에 저장하지 않는다.

## Out of Scope
- 일반 API 키로 조회할 수 없는 계정 전체 결제 잔액을 추정하지 않는다.
- Provider별 관리자 키 또는 Cloud IAM 연동을 자동 구성하지 않는다.
- 웹 구독과 대화형 도구의 남은 사용량을 조회하지 않는다.

## Acceptance Criteria
- [ ] `provider use <name>`이 구성된 Provider만 활성화한다.
- [ ] `provider status`와 `provider usage --json`이 키를 노출하지 않는다.
- [ ] OpenAI, Anthropic, Gemini 응답 사용량을 공통 스키마로 누적한다.
- [ ] 월 토큰 예산이 있으면 잔여량을 계산하고 없으면 `unknown`으로 표시한다.
- [ ] 단위 테스트와 `verify --full`이 통과한다.

## Risk
- 낮음

## Notes
- Created from harness CLI.
