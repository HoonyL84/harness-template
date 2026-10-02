# 운영 고도화 리허설 검증

실행: 2026-10-02, Windows / 로컬 Node 22.21.0. 가이드의 권장 Node 24 및 macOS/Linux 검증과 구분한다. 사용자 승인 범위는 개인 Atlassian의 HARNESS REHEARSAL 합성 티켓·결과 문서다. 기존 광고/결제 저장소는 변경하지 않았다. 원격 Git push와 유료 모델 요청도 하지 않았다.

## 실제로 확인한 것

| 범위 | 결과 | 근거 |
| --- | --- | --- |
| 개인 Jira | 합성 티켓 2개 생성·조회·로컬 DRAFT 연결, 계획 승인 전 실행 금지 | MCP 실제 응답, isolated outbox |
| Jira 상태 | 각 티켓이 진행 중 → 검토 중 → 완료로 이동 | 승인된 transition 결과와 최종 상태 재조회 |
| 개인 Confluence | 결과 페이지 2개 생성 | 게시 응답, 부모/공간/marker 본문 재조회 |
| 로컬 격리 실행 | 두 실제 Git worktree와 Node assertion·HTTP 시작/응답/종료 | rehearsal-helper.js 실제 자식 프로세스 |
| 실패 복구 | 첫 프로젝트 첫 패치 검증 실패 → 원복 → 근거 있는 수정 성공 | 누적 2회 이력, 실제 Git patch 및 assertion |
| 관리형 로컬 commit | 합성 작업의 별도 검수·일회성 승인 후 커밋, 재사용 거부 | 새 임시 저장소의 실제 Git SHA와 승인 기록 |
| 새 control-root | 암호화 백업 복원·이력 조회·새 경로 clone 및 재등록 | fresh-operations.test.js |
| 복원 경계 | 과거 USER_REVIEW·release·lease를 live 승인/실행으로 재활성화하지 않음 | fresh-operations.test.js 및 backup 회귀 |

실제 원격 ID·사이트·공간·로컬 경로는 Git에 올리지 않는 `.harness/local/rehearsals/2026-10-02-operations.json`에 보존했다. 외부용 문서에는 합성 검증 범위와 결과만 기록한다. 티켓·페이지는 테스트 이력으로 남겼으며 삭제하거나 실제 제품 완료로 바꾸지 않았다.

## 발견하고 보완한 마찰

1. 워크플로 읽기 매핑 누락: Jira 티켓 생성까지 성공한 뒤 `jira.projectStatuses` 매핑 부재로 중단했다. 새로운 티켓을 만들지 않고 기존 실행을 재개했다. 공식 MCP 스키마의 `listJiraStatuses`를 확인해 project/status 읽기 매핑을 로컬에 추가했다.
2. Native 응답 형식 차이: MCP의 `statuses` + `workTypes.statusIds` 객체를 기존 REST형 목록으로 바꾸는 계약이 없었다. 검증된 ID·category로 연결하고 중복/미상 참조는 거부하는 회귀 테스트를 추가했다. REST 자동 fallback은 하지 않았다.
3. 중앙 API 작업 귀속: 관리형 runner가 하네스 자체 active 티켓을 조회해 관련 없는 다중 티켓 때문에 실패할 수 있었다. 검증된 project/request/ticket 귀속으로 분리하고 단독 run-agent의 엄격한 active 검사도 유지했다. scope 선택은 회귀 검사했지만 실제 유료 API 호출은 하지 않았다.

## 합성 또는 아직 확인하지 않은 것

- AI 응답은 고정 패치와 repair 근거 fixture다. 실제 모델의 계획·개발 성능을 검증한 것이 아니다.
- 사용자 검수/승인 판단과 notification 전달은 fixture다. 실제 사용자가 제품 diff를 승인했거나 Telegram/Slack 메시지를 수신했다는 증거가 아니다.
- 실계정 변경은 건별 preview digest 승인을 사용했다. standing-consent 자동 follow-up 전체 흐름을 실제 계정에서 검증했다고 주장하지 않는다.
- 깨끗한 임시 control-root와 새 경로 테스트는 성공했지만 실제 새 PC, 독립 사용자, macOS/Linux 실계정 운영 재현은 아니다. 이번 브랜치의 원격 CI도 별도다.
- 공급자 관리자 잔액, Gemini billing/OAuth 갱신, 실제 사용자 개입 시간·95% 절감은 확인하지 않았다. 보고서는 미측정 값에 `null`을 사용한다.

## 재현과 검수

```bash
node --test tests/harness-cli/fresh-operations.test.js tests/harness-cli/operations-report.test.js tests/harness-cli/atlassian-mcp-contracts.test.js
node tools/harness-cli/index.js history audit-tasks
node tools/harness-cli/index.js verify --full --offline --task operations-evidence-rehearsal
```

자동 회귀는 새 임시 저장소를 만들고 원격 서비스에 쓰지 않는다. 실계정 재실행은 별도 게시 범위 승인과 기존 outbox 확인 후 수행한다. 실패 시 동일 POST를 맹목적으로 재시도하거나 기존 승인·사용자 작업을 지우지 않는다.
