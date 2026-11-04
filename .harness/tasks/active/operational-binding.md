# TICKET: operational-binding

## Type
fix

## Goal
- 모델 라우팅·알림·메모리 검증의 운영 경로 연결

## Scope
- 위험도 계약 및 승인 호환성, 기획 라우팅, 기존 알림 패치 선별 통합, 메모리 CLI/Full 연결과 회귀 테스트

## Out of Scope
- 기존 개인 파일, 실계정 전송, 커밋/푸시/병합

## Acceptance Criteria
- [x] 승인된 risk 보존, 저위험 기획 fast 및 고위험 strong, 실패 채널 재전송, 메모리 오류 Full 차단, 레거시 로딩

## Risk
- 낮음

## Notes
- Created from harness CLI.

## EXEC_PLAN
1. A: risk/근거/출처의 계획-실행 결속, 레거시 지문 보존, 고위험 fast 거부, 기획/설계 라우팅 정리. 검증: 라우터 및 runner 파이프라인 회귀.
2. B: 이전 작업 폴더의 알림 코드만 선별 통합. 검증: 타임아웃, 부분 성공, 재시작, 채널별 재시도 및 agent/build/Git 재실행 방지.
3. C: 기존 memory 사전 검사 후 독립 CLI/check/Full 연결. 검증: 잘못된 frontmatter, 알 수 없는 레이어, 중첩 노트, 오래된 Full 및 Quick 우회 차단.
4. 전체 테스트/lint/Full/drift 후 자체 검토. 커밋·푸시·실계정 API 및 알림 전송은 범위 제외.

## Compatibility / Limits
- 사전 검사: 기존 memory 노트 0개, 형식 위반 0개. README/template은 검사 제외.
- A/B/C는 독립 모듈 및 테스트로 분리하며 공통 CLI 진입점의 해당 변경만 함께 적용/원복한다.
- 메모리는 형식 검사만, 알림은 exactly-once 보장 아님. 인간의 최종 검수·Git 승인 유지.

## Verification Evidence
- 전체 회귀 테스트: 345 pass / 0 fail / 0 skip (provider 및 전송은 fixture).
- ESLint 및 git diff --check 통과.
- 임시 파일 rename의 샌드박스 EPERM은 정상 로컬 권한 재실행에서 해소. 제품 테스트 실패와 분리 기록.
- Full 검증 최종 결과는 observability/metrics/operational-binding.verify.json 및 traces의 로그로 기록한다.
- 실계정 알림/API 호출, 원격 CI, 커밋·푸시는 수행하지 않음. 사용자 검수/릴리스까지 active 유지.
