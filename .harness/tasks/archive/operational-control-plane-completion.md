# TICKET: operational-control-plane-completion

## Type
feat

## Goal
- 상세 티켓 계획, 자동 알림, Evidence 초안, 토큰 최적화와 배포 이력 기록을 중앙 제어면에 완성한다

## Scope
- [x] 승인 지문에 결속되는 상세 티켓 맥락·인수 기준·구현 단계·테스트 계획 스키마
- [x] 계획 준비, 차단, 검토 준비, 릴리스 승인/적용과 배포 기록의 중복 방지 자동 알림
- [x] 관리형 commit 성공 시 private DRAFT evidence 초안 자동 생성
- [x] 재시도 컨텍스트 재사용, 실패 피드백 전달과 추정 토큰 사용량 기록
- [x] 프로젝트 Git commit을 검증하는 append-only 배포 이력 원장과 조회 CLI
- [x] README, 운영 가이드와 AI 소개 문서 동기화

## Out of Scope
- 실제 배포 실행 또는 운영 인프라 변경
- 사용자 승인 없는 commit, push, merge
- 모델 공급자의 실제 청구 토큰을 범용적으로 수집하는 기능
- Evidence 초안의 자동 공개 또는 VERIFIED 승격
- 별도 자연어 해석 API/CLI

## Acceptance Criteria
- [x] 상세 티켓 필드가 계획과 실행 상태에 복사되고 승인 후 변조가 거부된다
- [x] 재시도는 같은 컨텍스트를 재사용하고 직전 오류를 전달하며 추정 토큰을 기록한다
- [x] 상태 전이 알림은 전송 성공 후 중복 제거되고 실패 시 재시도 가능하다
- [x] 관리형 commit은 중복 없는 private DRAFT evidence를 생성한다
- [x] 배포 원장은 등록 프로젝트의 실제 commit만 기록하고 동일 ID 덮어쓰기를 거부한다
- [x] 전체 테스트, lint, coverage와 Full verify가 통과한다

## Risk
- 낮음

## Notes
- Created from harness CLI.
- 단위: request-plan, runner prompt/metrics, transition notifier, deployment schema/ledger, evidence draft
- 통합: managed commit -> execution release history + evidence draft
- 회귀: npm test, npm run lint, npm run coverage, npm run harness -- verify --full

## Completion
- Completed At: 2026-08-30T13:21:54Z
- Verify Result: pass
- Rework Count: 1
- Last Failure: Node coverage: ERROR: Coverage for branches (72.67%) does not meet global threshold (73%)
