# 하네스 티켓 상태 점검

점검: 2026-10-02. `history audit-tasks`와 현재 티켓·검증 문서를 대조했다. 과거 성공 기록을 삭제하거나 현 시점의 사용자 수락으로 바꾸지 않는다.

| 운영 검수 대기 티켓 | 구현 근거 | 별도로 남은 조건 |
| --- | --- | --- |
| ops-ticket-review | request-plan/runner/Jira 입력 검증, 수용 기준 체크 완료 | 최종 사용자 결과 검수·마감 기록 |
| ops-followup-integration | 후속 기록·동의·outbox·MCP 계약 테스트 및 제한된 실계정 근거 | standing-consent 전체 실계정 운영과 사용자 최종 검수 |
| ops-project-context | 프로젝트별 스냅샷·이력·Confluence 문서 선별 | 자동 원격 freshness가 아님; 필요한 시점의 refresh 및 운영 검수 |
| ops-ticket-search | 중앙/legacy 필터와 원격 검색 회귀 | 실제 업무 기록 누락 점검 및 결과 검수 |
| ops-work-history | intent·불확실한 게시 reconciliation·근거 연결 | 실제 업무 기록 누락 점검 및 결과 검수 |
| ops-provider-account-usage | 관리자 usage/Cloud Monitoring 읽기 모의 검사 | 실제 관리자 권한 조회, Gemini 비용/OAuth 자동 갱신 미지원 |
| ops-ax-e2e-guide | 운영 가이드·두 프로젝트 통합 테스트 | 독립적인 새 사용자/새 기기 재현, 실제 사용자 시간 측정 |
| provider-usage | 3사 월별 관측 사용량·선택·설정 예산 테스트 | 체크박스/최종 검수·마감 기록 정합성 확인; 구독 잔액은 지원하지 않음 |

이 목록은 **8개 기능이 전부 미구현이라는 뜻이 아니다**. 기존 active 상태와 실제 구현 진척이 일치하지 않는 부분을 드러낸 것이다. 기본 구현 체크와 운영 조건을 구분하고 사용자 검수 후 정상 마감 절차로 이동한다. archive했다고 실계정·타 OS·독립 사용자 재현까지 성공한 것으로 표현하지 않는다.

이번 lean-evidence-workflow와 operations-evidence-rehearsal은 같은 작업 브랜치에서 검증 후 함께 Git 반영할 예정이다. 사용자 승인 전에는 커밋·푸시·완료 기록을 임의로 만들지 않는다.

## 2026-10-03 상태 정돈

위 8개 티켓의 운영 수락 근거가 충분하지 않아 자동 마감하지 않았다. 원문을 보존해 review/로 이동하고 Operational Review에 잔여 조건을 명시했다. 작업 중 티켓과 구분되며 history audit-tasks/search와 dashboard에서 조회한다. 운영 조건 충족 후 from-review로 재개해 fresh Full 검증과 사용자 검수 후 마감한다.
