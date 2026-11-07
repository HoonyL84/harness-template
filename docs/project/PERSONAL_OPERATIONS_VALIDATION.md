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

2026-10-02 추가 검증: [운영 고도화 리허설](OPERATIONS_REHEARSAL_VALIDATION.md)에서 개인 Jira 합성 티켓 2개의 생성·연결·상태 변경과 Confluence 결과 2개의 게시/재조회를 확인했다. 별도 임시 저장소에서 실제 Git/HTTP와 암호화 복원·새 경로 온보딩도 검사했다. AI 응답·사용자 승인 판단·알림 전달은 fixture이며, standing-consent 전체 실계정 흐름·독립 사용자/새 PC·실제 비용/시간 절감은 여전히 별도 검증이다.

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

시간은 자동 측정하지 않는다. 직접 측정값은 `history measure`로 기록하고 `history report`로 티켓별 관측 usage·검증 시간·수용 기준 근거와 함께 조회할 수 있다. [보고서 가이드](../OPERATIONS_EVIDENCE_GUIDE.md)를 참고한다. 게시할 때는 queue-result의 summary에 검토한 요약만 전달한다.
전체 개입 시간 = 요구 설명 + 설정 + 검수 + 수습. 기준선과 비교 대상 작업의 범위를 맞춰야 하며 95% 절감은 아직 목표다.

---

## 실사용 운영 지표 정의 (Metric Definitions) 및 비교 측정 규격

향후 실사용 로그 누적 시 숫자의 정의가 흔들리지 않도록 핵심 지표를 다음과 같이 고정한다.

### 1. 핵심 지표 정의

| 지표명 | 산식 및 판정 기준 | 측정 목적 |
| :--- | :--- | :--- |
| **1. 사고 (Incident)** | ① 고위험 경로(`.github`, `infra`, `k8s`, `migrations`, `deploy`, `scripts` 등)나 승인 범위 외부 파일이 **사람의 사전 승인 없이 커밋/PR에 반영된 건수**, 또는 ② `main` 병합 후 기존 테스트/빌드가 깨져 **롤백(Revert)한 건수** | 권한 경계 및 사전 검증 게이트의 실질 방어력 확인 |
| **2. 승인 패스(Fast-Track) 통과율** | `Fast-Track 대상 저위험 티켓 중 중간 수동 개입 없이 REVIEW_READY(검증 통과)에 도달한 티켓 수 / 전체 Fast-Track 시도 티켓 수 (%)` | L4.5/L5 자율 루프의 실질 자동화 성공률 측정 |
| **3. 서킷 브레이커(`BLOCKED`) 사유 분포** | `BLOCKED` 전환 건수를 4개 코드 사유로 분류:<br>① `same-error-repeat` (동일 에러 SHA-256 지문 2회 연속)<br>② `APPROVAL_REQUIRED` (고위험 경로·파일 삭제/모드 변경 감지)<br>③ `verify-failed-budget` (재시도 예산 소진)<br>④ `dependency-or-lease` (선행 SHA 미충족·Lease 충돌) | 무작정 재시도하지 않고 조기 중단한 근거 분포 확인 |
| **4. 검수 재작업률 (Review Rework Rate)** | `REVIEW_READY 도달 후 사람이 changes-requested(수정 요청)를 반환한 티켓 수 / 전체 검수 티켓 수 (%)` | 테스트(`verify --full`)는 통과했으나 의미적 요구사항이 어긋난 비율 |
| **5. 리드타임 및 수동 개입 횟수** | 티켓당 **사람이 직접 판단/명령을 내린 횟수**(계획 승인, 중간 수락, 릴리스 승인) 및 **요청부터 PR 병합까지 걸린 시간(분)** | 설계상 게이트 축소(`4단계 → 2단계`)가 실제 개입 감소로 이어지는지 측정 |

### 2. 실사용 티켓 검증 기록 (`ad-domain-ml-upgrade`)

동일하거나 유사한 난이도의 기능/버그 티켓을 수행할 때 아래 항목(실행 방식, 수동 개입 횟수, 범위 외 파일 수정/검증 누락 건수, 검수 후 재작업 횟수, 서킷 브레이커 발동 여부)을 사실대로 기록한다. 미측정 시간은 임의 기입하지 않는다.

| 요청 / 티켓 ID (`project_id`) | 위험도 및 실행 방식 | 수동 개입 횟수 | 범위 외 수정 / 검증 누락 | 재작업(Rework) 및 서킷 브레이커 | 검증 및 릴리스 근거 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ad-domain-ml-upgrade` / `serving-matching-ranking-ml-llm` (`ad-server`) | `risk: medium` (Strict Governance) | 계획 승인 + 결과 확인 + PR 병합 승인 | 0건 (승인 범위 내 수정) | 재시도 0회, 서킷 브레이커 발동 0건 | `.\gradlew.bat test` (15/15 PASS) ➔ PR #1 병합 (`b687703`) |
| `ad-domain-ml-upgrade` / `event-attribution-last-click` (`ad-server`) | `risk: low` (Fast-Track 대상) | 계획 승인 + PR 병합 승인 | 0건 (승인 범위 내 수정) | 재시도 0회, 서킷 브레이커 발동 0건 | `.\gradlew.bat test` (15/15 PASS) ➔ PR #1 병합 (`b687703`) |
| `ad-server-deploy-guard-check` / `deploy-script-healthcheck-guard` (`ad-server`) | `risk: low` ➔ 고위험 경로 침범 (가드 검증용 의도적 유도) | 계획 승인 후 1차 시도에서 자동 중단(`BLOCKED`) | `scripts/deploy.sh` 수정 시도 **사전 차단 (Git 미적용)** | **서킷 브레이커 실발동 1건 (`APPROVAL_REQUIRED`, 의도적 유도)**, 1회 시도 후 즉시 정지 | `.harness/local/executions/ad-server-deploy-guard-check.json` |

