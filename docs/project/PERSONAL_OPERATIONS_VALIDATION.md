# 개인 운영 실무 시나리오와 검증 경계

작성: 2026-09-18. 실행 환경: Windows, Node 24. 이 문서의 통합 시나리오는 fixture이며 실제 계정 게시/비용 조회를 하지 않았다. 별도로 2026-09-21 개인 테스트 계정의 제한된 합성 Atlassian 게시·조회는 [MCP 계약 기록](../ATLASSIAN_MCP.md)에 구분해 남겼다.

| 질문 / 상황 | 기대 동작 | 코드/테스트 근거 |
| --- | --- | --- |
| A/B 프로젝트 일을 함께 요청하면? | 요청 초안/프로젝트 분리, 사용자의 계획 승인 후 실행 | personal-operations-e2e.test.js |
| 첫 시도 실패 후 성공하면? | 실패 근거 보존, 누적 횟수 유지, 최종 검수 알림 | agent-runner.test.js, personal-operations-e2e.test.js |
| 3회 실패 / 권한 오류라면? | BLOCKED. 권한·예산·보호 경로 문제는 조기 중단 | agent-runner.test.js |
| 알림만 실패하면? | 개발을 다시 하지 않고 runner notify로 재전송 | agent-runner.test.js |
| 프로세스가 끊기면? | 미완료 intent/lease를 성공으로 추측하지 않음 | work-history.test.js, agent-runner.test.js |
| 검수 뒤 파일이 달라지면? | 현재 content fingerprint와 비교해 거부 | work-history.test.js, control-plane-e2e.test.js |
| 완료 때 검증 파일이 없어지면? | 정리 전 COMPLETION_EVIDENCE에 원본 근거 저장 | index.js commandCompleteTask |
| 이전 작업 검색은? | 중앙/legacy 구분, 한글·기간·프로젝트 필터 | work-history.test.js |
| Jira 생성 요청을 두 번 누르면? | 동일 티켓 중복 큐/재전송 억제 | atlassian-command.test.js |
| 게시 응답을 잃으면? | unknown 상태 유지, marker 확인 전 자동 POST 금지 | atlassian-command.test.js |
| 원격 게시 대상이나 내용이 바뀌면? | preview digest 불일치로 거부 | atlassian-command.test.js |
| Jira 칸반 상태를 바꾸면? | 가능한 transition과 현재 수정 시각을 확인하고 별도 승인 후 변경 | atlassian-command.test.js |
| 원격 상태/중요도/기간으로 찾으면? | 프로젝트 범위 유지, priority ID 매핑, 날짜 검증 | atlassian-read.test.js |
| 이전 대화 내용을 다음 도구가 읽으면? | 프로젝트별 최근 기록/문서 스냅샷, 크기 제한/비신뢰 처리 | work-history.test.js, atlassian-read.test.js |
| 사용량 API에 권한이 없으면? | null/permission-denied. 다른 공급자 결과 보존 | provider-account-usage.test.js |
| 개인 Atlassian을 어떻게 연결하나? | connect/check/discover/map. 읽기 검증 후 로컬 매핑 저장; 원격 게시 없음 | connection-setup.test.js |
| 설정이 바뀌거나 다른 공간의 페이지를 지정하면? | 검증 실패/설정 경합 시 기존 설정 보존; 기존 매핑 변경은 replace 필요 | connection-setup.test.js |
| 3사 키가 모두 있어야 하나? | 사용할 공급자만 키 설정. 3사 각각 진단, 다른 공급자 실패와 분리 | connection-setup.test.js |
| Gemini 사용량이 빈 응답이면? | no-data/null. 실제 0인 DELTA 포인트와 구분; 프로젝트 요청 수이며 잔액 아님 | gemini-account-usage.test.js |

## 검증 수준

- 순수 로직/파일 저장/모의 HTTP: 새 기능 테스트 통과.
- 두 프로젝트 통합 시나리오: 임시 디렉터리에서 실제 명령 핸들러 연결. 모델 호출, Git 준비, 프로젝트 테스트는 fixture 어댑터이며 실제 개발 성공 증거는 아니다.
- 기존 Git worktree/관리형 release 회귀: 기존 통합 테스트 유지.
- Full 검증: coverage 임계값, ESLint/build 통과. `--offline`이므로 AI 원격 리뷰는 생략.
- 일반 CLI의 macOS/Linux CI와 실제 계정의 전체 운영 흐름은 서로 다른 검증이다. 개인 테스트 계정의 제한된 합성 게시·조회는 확인했지만, 전체 Atlassian 운영, 관리자 사용량 API, 독립적인 새 사용자의 문서 재현은 미검증.
- 실제 운영 키/게시 위치 제공 전 임의의 계정 생성, 실제 게시, Git 커밋/푸시를 하지 않는다.

## 아직 남은 범위

추가 보완: `operations-followup.test.js`의 16개 시나리오로 같은 DRAFT의 Jira 연결, 실행 결과 follow-up, 검수/완료 구분, 승인 후 변경 차단, 게시 실패 재시도 및 누락 복구를 모의 HTTP로 검증했다. 기본 건별 payload 승인 외에 최초 프로젝트 범위 승인 후 자동 게시를 지원한다.

- 최초 승인 이후 티켓 생성/연결 → runner RUNNING → REVIEW_READY → 사용자 수락 → COMPLETED와 결과 페이지 기록을 모의 검증했다. 계획 승인/Git 승인으로 확대되지 않는다.
- 승인 철회, 목적지/계정/매핑 변경, 임의 payload·본문 변조, 변경된 코드 지문, 전송 중 승인 철회를 차단한다.
- 오프라인·429·응답 유실·재진입·같은 이슈의 불확실한 선행 상태 변경을 검증했다. 검색은 게시하지 않고 기록 재개는 개발 시도 횟수를 늘리지 않는다.
- 이 통합 시나리오는 사용자 요청으로 모의 검증했다. 별도의 개인 테스트 계정에서 합성 게시·조회는 확인했으나, 이 시나리오 전체가 실제 서비스에서 성공했다는 뜻은 아니다.

1. Gemini 비용 조회와 OAuth 자동 갱신은 미구현이다. 모델 연결 진단 및 Cloud Monitoring 요청 수 조회는 구현/모의 검증했으며, 토큰 잔여량·구독 사용량을 뜻하지 않는다.
2. 깨끗한 신규 환경에서 실제 계정까지 연결한 운영 리허설과 타 OS 검증.
3. 실제 사용자 시간 측정. 모의 테스트 시간으로 AX 절감률을 만들지 않는다.

의도적으로 보장하지 않는 것: 자동 양방향 중요도 동기화/카드 이동 즉시 코드 실행, 코드와 문서의 의미적 일치 보증. 중요도는 Jira 입력을 다시 읽고 승인하며, 의미 판단은 AI와 사용자 검수에 남긴다.

기존 Confluence 페이지 자동 수정은 안전상 구현하지 않고 결과를 새 페이지로 추가한다. 이 방식에는 PUT 버전 충돌/자동 덮어쓰기 복구가 필요하지 않다. 요구가 생기면 별도 승인 정책을 설계한다.

## AX 경험 기록

작업별 결과 요약에 아래를 사실대로 남긴다. 미측정 값은 null이며 0으로 치환하지 않는다.

```json
{
  "request_id": "실제 요청 ID",
  "ticket_id": "실제 티켓 ID",
  "before": "이전 방식과 문제",
  "after": "실제로 바뀐 동작",
  "ai_contribution": "AI가 수행한 계획/구현/검증",
  "human_decisions": "사용자가 판단/승인한 범위",
  "baseline_human_minutes": null,
  "requirements_minutes": null,
  "setup_minutes": null,
  "review_minutes": null,
  "recovery_minutes": null,
  "evidence": ["실행/검증/릴리스 기록 경로"]
}
```

이는 측정용 기록 양식이지 자동 시간 측정 기능이 아니다. 게시할 때는 queue-result의 summary에 검토한 요약만 전달한다.
전체 개입 시간 = 요구 설명 + 설정 + 검수 + 수습. 기준선과 비교 대상 작업의 범위를 맞춰야 하며 95% 절감은 아직 목표다.
