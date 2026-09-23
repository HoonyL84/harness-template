# TICKET: ops-ax-e2e-guide

## Type
feat

## Goal
- 새 사용자가 이전 대화나 추가 설명 없이 가이드만 따라 운영하도록 전체 흐름을 검증하고, 실제 AX 경험과 절감 측정 근거를 남긴다

## Scope
- 두 프로젝트 E2E, 시작/실패/재개/검토/완료/검색 가이드, 수작업 시간 기준선과 기록 내보내기

## Out of Scope
- 승인 없는 commit/push/merge, 계정 생성 및 게시 범위 확인 없는 외부 쓰기, 미측정 성과 주장

## Acceptance Criteria
- [ ] README에서 연결되는 단일 시작 가이드 docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md를 제공한다. 구현 전 명령을 사용 가능한 기능처럼 안내하지 않는다.
- [ ] Windows/macOS/Linux 준비 사항, 최초 설치, 기존/신규 프로젝트 등록, 대화형/API 실행 차이와 과금 주체, 로컬 키 설정 및 연결 확인을 설명한다.
- [ ] Jira 프로젝트/칸반, Confluence 공간, Telegram 설정을 계정 준비부터 권한/대상 지정/연결 테스트까지 안내한다. 비밀값 예시는 placeholder만 사용한다.
- [ ] 요청 -> 티켓 확인/중요도 -> 계획 승인 -> 최대 3회 시도 -> 알림 -> 사용자 검수 -> 별도 Git 승인 -> 검색/이력 조회의 실제 예시를 제공한다.
- [ ] 각 절차에 선행 조건, 사용자 행동, AI/하네스 행동, 실제 명령, 예상 결과, 성공 확인 방법, 실패 시 다음 행동을 포함한다.
- [ ] 인증 만료/권한 부족, API 제한, 3회 소진, 실행 중단/재개, 승인 후 변경, 동기화 충돌/알림 실패, 백업/복원과 PC 이전을 설명한다. 미지원 기능은 대안을 명시한다.
- [ ] 이전 대화나 작성자의 추가 설명 없이 깨끗한 임시 환경에서 가이드만 따라 등록부터 검색까지 재현하고, 막힌 지점을 수정한 기록을 남긴다. 미실행 OS/실계정 시나리오는 미검증으로 표시한다.
- [ ] 문서 명령/설정명/기본값/링크와 실제 CLI를 대조하며, 동작을 바꾸는 후속 변경에는 관련 가이드 갱신과 시나리오 재검증을 요구한다.
- [ ] 1회 성공, 재시도 후 성공, 3회 소진, 즉시 중단, 재시작 후 누적 횟수 유지 및 알림 중복 억제를 검증한다.
- [ ] Confluence fixture 검증과 실제 지정 space의 게시/읽기/수정/검색 검증을 구분한다. 계정이 없으면 실제 연동은 미검증으로 보고한다.
- [ ] 두 테스트 프로젝트에서 초안, 사용자 설정 승인, 실행, 검증, 결과 검수, 이력 검색을 검증한다.
- [ ] 중단 후 재개와 기록 실패 케이스를 포함하고 Windows/macOS/Linux 검증 결과를 구분해 남긴다.
- [ ] 요구 설명/설정/검수/수동 수습 시간을 포함한 전체 사용자 개입 시간과 반복 운영 시간을 별도 기록한다.
- [ ] 95% 절감은 기준선과 실제 측정 전까지 목표로 표시하고 미측정 값을 0으로 계산하지 않는다.
- [ ] 설계 이유, 변경 전후, 실패 사례, AI 기여와 사용자 판단을 근거와 함께 기록하고 Markdown/JSON으로 내보낸다.

## User Settings
- Settings status: IMPLEMENTATION_AUTHORIZED; priority and final result review remain with user
- Priority suggestion: P1
- Shared max attempts: 3 (initial attempt 1 + retries 2; no per-ticket input)
- Effective priority: not assigned
- Planned max attempts: 3 (implemented in API runner)
- Result review: required from user

## Dependencies
- ops-ticket-search
- ops-project-context
- ops-provider-account-usage

## Plan Reference
- docs/project/OPERATIONS_COMPLETENESS_PLAN.md
- docs/project/CONFLUENCE_PERSONAL_OPERATIONS.md
- 사용자가 구현 진행을 승인했다. 중요도 제안값은 사용자 확정 전 실행 설정으로 사용하지 않는다.

## Risk
- 중간

## Notes
- Created from harness CLI.

## Implementation Progress
- Expanded personal operations guide with actual commands, public-payload review, source binding, retry/reconciliation, query/context and account-usage setup.
- Added PERSONAL_OPERATIONS_VALIDATION.md with practical Q&A, evidence links, unsupported features and honest AX measurement template.
- Added two-project fixture E2E covering request approval, retry, notification, user review, process reentry, search and explicit Confluence publication.
- Fixture Git/AI/API adapters are not claimed as live operational validation. Independent new-user and macOS/Linux/live-account rehearsal remains.
