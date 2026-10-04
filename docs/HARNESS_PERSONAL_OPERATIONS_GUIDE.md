# 개인 하네스 운영 가이드

> 2026-09-20 변경: Atlassian은 **MCP 우선, REST는 명시적 선택**이다. 먼저 [MCP 설정과 역할 분리](ATLASSIAN_MCP.md)를 읽는다. 아래 기존 REST 예시를 그대로 사용하려면 연결 설정에 `transport: "rest"`가 필요하다. 개인 테스트 계정의 제한된 합성 시나리오는 검증했지만 전체 운영 흐름은 별도다.

상태: 2026-09-27, 단계별 구현 중. 이 문서는 현재 구현된 명령을 안내한다.
개인 테스트 계정 연결이 전체 로드맵이나 실계정 운영 흐름 완료를 뜻하지 않는다.

## 1. 지금 가능한 범위

| 항목 | 현재 상태 |
| --- | --- |
| 프로젝트 등록, 격리 worktree, 계획/Git 승인 | 기존 구현 |
| Jira 이슈 읽기 -> 로컬 DRAFT | 구현, 모의 API와 개인 테스트 계정의 제한된 읽기 검증. 전체 운영 흐름 미검증 |
| Jira 제목/본문/중요도 변경 감지 | 승인/준비/검수 준비/API 실행/관리형 릴리스 경계에서 재조회 |
| 로컬 중요도 설정 | DRAFT에서 P0/P1/P2/P3, 기본 P2 |
| API runner 기본 최대 3회, 시도 이력, 결과 알림 대기열 | 구현. 기존에 승인한 명시적 한도는 보존 |
| Jira 티켓 생성, Confluence 결과 게시 | 승인 digest로 명시적으로 게시. 원격 응답 유실은 확인 대기 |
| Jira/Confluence 검색, Confluence 배경 읽기 | 프로젝트/space 제한, 페이지네이션 및 버전 스냅샷 |
| 이력/기존 티켓 검색, 검수 기록 | history 명령. 로컬 기록 보존 및 프로젝트별 컨텍스트 연결 |
| OpenAI/Anthropic 계정 사용량·비용 | 별도 관리자 키로 조회. 실제 잔액/구독 잔여량은 unknown |
| Jira 상태 변경 | 가능한 transition 조회 후 preview 승인으로 변경. 카드 이동에 따른 코드 자동 실행은 아님 |
| 상태·결과 기록 연결 | 관리형 실행/검수 후 로컬 follow-up 자동 생성. audit/repair → prepare → 게시 승인 |
| 로컬 티켓과 Jira 연결 | 게시 성공 후 link로 같은 DRAFT에 연결. 구현·테스트 계획 유지, 재승인 필수 |
| Atlassian 연결 설정 | connect/check/discover/map. 로컬 저장 + 읽기 검증. 개인 계정의 Jira/Confluence 읽기와 두 프로젝트 매핑 확인; 쓰기 권한은 별도 |
| 3사 연결 진단 | OpenAI/Anthropic/Gemini 모델 목록 GET. 생성 호출 없이 인증 접근 확인 |
| Gemini Cloud 조회 | 프로젝트 API 요청 수 조회. 토큰·잔액·비용은 별도이며 제공하지 않음 |
| 카드 이동으로 자동 실행, 상시 원격 감시 | 지원하지 않음 |
| 대화형 AI의 모든 파일 쓰기/모델 호출 횟수 차단 | 보장하지 않음. API runner의 횟수 제한과 다름 |

기능 상태는 [운영 보강 계획](project/OPERATIONS_COMPLETENESS_PLAN.md)과 함께 갱신한다.
별도 질문 없이 따라 할 수 있는 전체 가이드와 신규 환경 재현은 마지막 티켓의 완료 조건이며 아직 완료되지 않았다.

## 2. 설치와 준비

Node.js 24, npm, Git 및 프로젝트 자체 테스트 도구가 필요하다.
Windows/macOS/Linux에서 아래 `node` 명령은 동일하다. 경로만 실제 절대 경로로 바꾼다.

```sh
git clone https://github.com/HoonyL84/harness-template.git
cd harness-template
npm ci
node tools/harness-cli/index.js check
```

Windows PowerShell에서 npm 실행 정책 오류가 나면 `npm.cmd ci`를 사용한다.
`check`는 `.env.local` 생성/환경 점검을 한다. 신규 기능이 아직 원격 브랜치에 반영되지 않았다면 클론만으로 이 문서의 신규 명령을 사용할 수 없다. `help`에서 명령을 먼저 확인한다.

```sh
node tools/harness-cli/index.js help
```

프로젝트 등록과 최초 Git bootstrap은 [기존 운영 가이드](HARNESS_GUIDE.md)를 따른다.
기존 Git 프로젝트 예시:

```sh
node tools/harness-cli/index.js project add demo --path "<기존 프로젝트 절대 경로>"
node tools/harness-cli/index.js project onboard demo
node tools/harness-cli/index.js project profile demo
# 사용자가 검사/검증 명령과 프로젝트 범위를 확인한 뒤에만:
node tools/harness-cli/index.js project onboard demo --approve
```

기대 결과: `demo` 등록 및 APPROVED profile. 실패하면 프로젝트 경로/Git HEAD/테스트 명령을 확인한다.
원본 프로젝트의 미커밋 작업을 버리거나 임의로 초기화하지 않는다. 승인된 프로필에 미커밋 변경이 있거나 준비 시점에 새 변경이 생겼다면 `execution prepare`는 worktree 생성 전에 `BLOCKED`로 멈춘다. 변경을 수동으로 정리한 뒤 현재 HEAD로 재온보딩하고 새 요청 계획을 승인한다(기존 승인 계획은 수정할 수 없다). 미커밋 내용을 조용히 제외한 채 실행하지 않는다.

## 3. 개인 Jira 연결

이 단계는 개인 로컬 스크립트용 연결이다. 타인에게 제공하는 클라우드 앱의 인증 설계는 별도로 검토해야 한다.
회사 자료를 개인 Jira/Confluence에 올려도 되는지 먼저 확인한다.

사용자가 준비할 것:

- Jira Cloud 사이트와 읽을 프로젝트, 테스트용 이슈 1개.
- 계정 이메일과 해당 이슈를 읽을 권한이 있는 API 토큰.
- scoped 토큰이면 해당 사이트의 cloud ID. Atlassian 연결/사이트 정보에서 확인한 값만 사용한다.
- 사이트의 실제 Jira priority ID와 하네스 중요도 사이의 매핑. ID 숫자의 의미를 임의 추측하지 않는다.

`.env.local`에 이메일과 토큰을 설정한다. 채팅/티켓/커밋에 토큰을 붙이지 않는다.

```dotenv
ATLASSIAN_EMAIL=<계정 이메일>
ATLASSIAN_API_TOKEN=<API 토큰>
```

### 3.1 연결 도우미 사용 (권장)

키를 로컬에 입력한 뒤 다음 순서로 진행한다. 아래 예시의 사이트, ID, 프로젝트 이름은 실제 값으로 바꾼다.
프로젝트와 공간은 Atlassian 화면에서 먼저 만들며 이 명령은 원격 자원을 생성하지 않는다.

```sh
node tools/harness-cli/index.js atlassian connect --site https://your-site.atlassian.net
# scoped 토큰이면 처음 connect할 때 --cloud-id <UUID>도 지정한다.
node tools/harness-cli/index.js atlassian check
node tools/harness-cli/index.js atlassian discover
node tools/harness-cli/index.js atlassian discover --jira-project DEMO --space-id 12
node tools/harness-cli/index.js atlassian map --project demo --jira-project DEMO --issue-type 10001 --space-id 12 --parent-id 34 --context-pages 35,36 --priority-map 1:P0,2:P1,3:P2,4:P3
```

- `connect`: 비밀키 없이 사이트 설정만 저장한다. `configured-not-verified`는 인증 성공이 아니다. 이미 설정된 다른 사이트/게이트웨이로 교체하지 않는다.
- `check`: Jira 사용자 인증과 Confluence 공간 읽기를 각각 검사한다. 둘 다 `readable`인지 확인한다. 쓰기·상태 변경 권한은 아직 검증하지 않는다.
- `discover`: 접근 가능한 프로젝트/공간/priority ID를 보여준다. 프로젝트를 지정하면 이슈 유형, 공간을 지정하면 페이지를 보여준다. 첫 페이지만 조회하므로 `truncated: true`이면 나머지는 Atlassian 화면에서 확인한다.
- `map`: `project add`로 등록한 하네스 ID에 실제 Jira 프로젝트/일반 이슈 유형/Confluence 공간과 페이지를 연결한다. 페이지의 공간·현재 상태를 읽기 검증한 뒤 원자적으로 저장한다. 다른 프로젝트 매핑은 보존한다.
- `--parent-id`, `--context-pages`는 선택 사항이다. priority 매핑은 사이트 공통이며 ID가 작다고 높은 중요도로 추측하지 않는다. 실제 이름을 확인한 뒤 사용자가 선택한다.
- 기존 매핑이나 기존 priority 값을 변경할 때만 `--replace`가 추가로 필요하다. 이미 대기 중인 게시 payload는 새 매핑으로 바뀌지 않으므로 `atlassian preview`로 목적지를 다시 확인한다.
- `missing-credentials`: `.env.local`의 이메일/토큰을 확인한다. `permission-denied`: 토큰 범위/계정 접근 권한을 확인한다. `offline`: `HARNESS_OFFLINE` 설정을 확인한다. `unavailable`: 네트워크/사이트/응답을 확인하고 다시 진단한다.
- 이 단계는 로컬 연결 설정이며 실제 게시에는 아래 `preview → sync --approve`가 여전히 필요하다. 여기서 승인한 것은 Git commit/push가 아니다.

### 3.2 수동 설정 참고

연결 도우미는 `.harness/local/atlassian.json`에 비밀값이 아닌 연결 대상/프로젝트 매핑을 저장한다. 직접 설정할 때도 같은 파일을 사용한다.
아래 모든 꺾쇠괄호는 실제 값으로 교체한다. 로컬 설정 디렉터리는 Git 제외 대상이다.

```json
{
  "site": "https://<사이트 이름>.atlassian.net",
  "cloud_id": "<scoped 토큰을 발급한 사이트의 cloud ID>",
  "jira_projects": { "demo": "DEMO" },
  "priority_map": { "<실제 Jira priority ID>": "P1" }
}
```

scoped 토큰은 `api.atlassian.com/ex/jira/<cloud_id>`로 호출한다. 일반 토큰을 사용하는 연결에서만 `cloud_id`를 생략한다. URL을 임의의 프록시/다른 도메인으로 바꾸지 않는다. Jira Data Center는 이 어댑터의 지원 대상이 아니다.

`request import-jira`는 읽기 전용이다. 이슈 생성과 Confluence 게시에는 아래 10절의 별도 승인 절차가 필요하다. Jira 프로젝트/Confluence 공간 자체를 자동 생성하지 않는다.

## 4. Jira 이슈에서 검토할 계획 만들기

사용자 요청 예: "DEMO-1을 읽고 코드를 확인해서 구현 범위와 테스트 계획을 만들어줘."

```sh
node tools/harness-cli/index.js request import-jira demo-work --project demo --issues DEMO-1
node tools/harness-cli/index.js request show demo-work
```

기대 결과: DRAFT, `jira-<숫자 issue ID>` 티켓, `planning_status: NEEDS_PLAN`.
기본 최대 시도는 3회다. 제목과 본문을 가져왔을 뿐 구현 계획이 완성된 것은 아니다.
이슈 상태가 In Progress/Done이어도 로컬 실행 승인으로 취급하지 않는다.

AI는 코드를 읽고 `.harness/local/requests/demo-work.json`을 참고해 별도 plan-file을 작성한다.
다음은 구조 예시다. 실제 이슈 ID, 목표, 테스트 및 범위로 바꾼다.

```json
{
  "goal": "중복 요청 처리 개선",
  "tickets": [{
    "ticket_id": "jira-10001",
    "project_id": "demo",
    "goal": "중복 요청이 부작용을 두 번 만들지 않게 한다",
    "priority": "P1",
    "scope": ["기존 요청 처리 경로와 회귀 테스트"],
    "exclusions": ["DB 변경은 별도 승인"],
    "acceptance_criteria": ["동일 키의 중복 요청이 한 번만 처리된다"],
    "implementation_steps": ["현재 중복 방어 확인", "필요한 최소 수정", "회귀 검증"],
    "test_plan": { "unit": ["동일 키 재요청"], "regression": ["서로 다른 키 요청"] }
  }]
}
```

```sh
node tools/harness-cli/index.js request revise demo-work --plan-file "<계획 JSON 절대 경로>"
node tools/harness-cli/index.js request priority demo-work --ticket jira-10001 --value P1
node tools/harness-cli/index.js request show demo-work
```

같은 티켓 ID로 revise하면 Jira 출처는 보존된다. Jira 상세 필드를 모두 구조적으로 해석하거나 요구사항의 의미적 정합성을 검증하는 기능은 아니다. AI와 사용자가 범위/의존성/실제 테스트 명령을 확인해야 한다.

사용자가 최종 계획을 승인한 뒤에만:

```sh
node tools/harness-cli/index.js request approve demo-work
node tools/harness-cli/index.js request ready demo-work
node tools/harness-cli/index.js execution prepare demo-work
```

기대 결과: 승인 지문에 계획/중요도/시도 정책/Jira 원본 스냅샷이 연결되고, 격리 worktree가 준비된다.
Jira 중요도와 로컬 중요도는 아직 양방향 동기화되지 않는다. 로컬 override는 최종 계획 화면에서 확인한다.

## 5. 실행 모드와 알림

대화형: 현재 AI에게 준비된 티켓/worktree/검증 명령을 읽고 작업하도록 요청한다.
이 경우 현재 대화 도구가 실행/과금을 담당한다. 하네스에 API 키를 넣었다고 대화 도구의 코드 작성이 자동으로 그 공급자로 전환되지는 않는다.
작업 후 `execution review-ready demo-work --ticket jira-10001`로 실제 검증을 실행한다.

API runner: `.env.local`에서 `HARNESS_AGENT_MODE=api`, `AI_PROVIDER` 및 해당 공급자 키를 설정한 경우 사용한다.

```sh
node tools/harness-cli/index.js runner run demo-work
node tools/harness-cli/index.js runner status demo-work
```

기대 결과는 REVIEW_READY(검수 대기) 또는 BLOCKED(조치 필요)다.
시도 횟수는 AI 호출 전에 저장한다. P0가 가장 높고 P3가 가장 낮으며 의존성은 중요도보다 우선한다.
복구 가능한 중간 실패는 기록만 남긴다. 동일 오류 반복, 권한/예산/안전 문제는 3회 이전에도 중단한다.

Telegram은 기존 `.env.local`의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 설정한다.
테스트 완료 알림은 사용자 검수나 배포 완료를 의미하지 않는다.

```sh
node tools/harness-cli/index.js runner notify demo-work
```

이 명령은 보류된 결과 알림만 재전송하며 개발을 다시 실행하지 않는다.
현재 별도 상시 재전송 프로세스는 없다. 다음 runner 실행 종료 또는 notify 명령에서 재전송한다.
전송 확인된 이벤트는 중복 억제하지만, 수신은 됐으나 응답을 잃은 경우 중복 알림 가능성은 남는다. 메시지 event ID로 구별한다.

## 6. 검수와 Git 반영

사용자가 diff, 검증 결과, 남은 위험을 직접 검수한다.
commit/push/merge는 별도의 명시적 승인과 release 절차가 필요하다.
[관리형 Git 승인 절차](HARNESS_GUIDE.md)를 사용한다. 이 가이드의 설치/실행 동의가 Git 반영 동의는 아니다.
Jira 원본 변경은 관리형 release 경계에서도 재확인한다. 외부 raw Git 명령 자체를 OS 수준으로 차단하지 않는다.

## 7. 문제별 조치

| 증상 | 확인 / 다음 행동 |
| --- | --- |
| HTTP 401/403 | 토큰 만료, 이메일, scope, Jira 프로젝트 권한 및 scoped cloud ID 확인. 토큰을 로그에 출력하지 않는다 |
| HTTP 429/5xx/timeout | 입력은 승인되지 않은 상태로 남는다. 잠시 후 읽기를 다시 시도한다. 현재 Jira 읽기에 자동 백오프는 없다 |
| priority mapping 오류 | 실제 Jira priority ID를 확인해 로컬 priority_map에 등록 |
| Jira inputs changed | 새 request ID로 다시 import하고 계획을 재검토. 기존 승인/시도 수를 수동으로 초기화하지 않는다 |
| Import 후 approve 거부 | 실제 acceptance_criteria/implementation_steps/test_plan을 보완해 revise |
| 3회 소진 또는 동일 오류 반복 | runner status에서 시도별 원인 확인. 수정 범위와 재개 계획을 승인받아 후속 요청으로 연결 |
| 실행 중 종료 | runner reconcile로 만료 lease를 점검. 진행 중이던 패치/복구 상태가 불확실하면 BLOCKED 유지, worktree를 먼저 검토 |
| 알림 PENDING | 키/채팅 대상/연결 확인 후 runner notify. 개발 재실행 불필요 |
| Confluence에 결과가 없음 | atlassian status로 PENDING/REJECTED/NEEDS_RECONCILIATION 확인. 아래 10절에 따라 게시/복구 |

```sh
node tools/harness-cli/index.js runner reconcile demo-work
node tools/harness-cli/index.js dashboard
```

자동 파괴적 초기화나 파일 삭제로 복구하지 않는다. 운영 중인 lease를 수동 제거하지 않는다.

## 8. 저장 위치와 이동 한계

- 프로젝트: `.harness/local/projects.json`, `profiles/`.
- 요청/승인 계획: `.harness/local/requests/`.
- 실행/시도/알림: `.harness/local/executions/`.
- Git 승인 이력: `.harness/local/releases/`.
- 기존 경력 근거: `.harness/local/career/ledger.json`.

이 자료는 Git 제외 대상이다. 원격 저장소에 push했다고 백업되지 않는다.
`backup create`로 실행을 멈춘 상태의 기록을 암호화하여 보존할 수 있다. 비밀키와 프로젝트 소스/worktree는 포함하지 않으며 별도로 보관해야 한다.
`backup restore`는 미리보기와 일회성 승인 후 과거 자료를 격리 폴더에 복원하고, 검색용 이력만 `RESTORED_*`로 추가한다. 과거 승인은 현재 작업의 승인이 되지 않는다.
키 재설정, 프로젝트 재등록, 경로/HEAD/변경 상태 확인과 새로운 계획·Git 승인이 필요하다. 자동 PC 이전이나 중단 실행의 투명한 재개는 지원하지 않는다.
명령과 보존 범위, 복원 실패 처리는 [기록 백업 가이드](STATE_BACKUP.md)를 참고한다.

## 9. 가이드 검증 현황

이번 단계는 단위/모의 API 테스트로 승인 변경, 횟수 소진/보존, 알림 재전송, Jira 인증/응답 오류를 검증한다.
개인 테스트 계정의 제한된 합성 게시·조회와 Jira/Confluence 읽기는 확인했다. 새로운 사용자의 전체 문서 재현과 macOS/Linux 실계정 운영은 미검증이다.
두 프로젝트의 승인, 실패 후 재시도, 검수, 이력 검색, 명시적 Confluence 게시를 임시 디렉터리/모의 어댑터로 검증했다. 실제 Git/모델/Atlassian을 모두 연결한 신규 환경 검증과는 구분한다.

공식 참조: [Jira 인증](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/), [Get issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/), [Scoped 토큰 endpoint](https://support.atlassian.com/confluence/kb/scoped-api-tokens-in-confluence-cloud/).

## 10. Jira 티켓 생성과 Confluence 게시

먼저 Jira 프로젝트/보드와 Confluence 공간 및 결과 페이지를 모을 부모 페이지를 사용자가 준비한다. Jira 보드에서 카드 상태를 변경해도 하네스 실행이나 Git 승인이 되지는 않는다.
실제 Jira issue type ID, Confluence space ID/space key/parent page ID를 확인해 3절 설정에 다음 항목을 추가한다. 예시 숫자를 그대로 사용하지 않는다.

```json
{
  "jira_issue_types": { "demo": "<실제 issue type ID>" },
  "confluence_projects": {
    "demo": {
      "space_id": "<숫자 space ID>",
      "space_key": "<space key>",
      "parent_id": "<숫자 부모 page ID>",
      "context_page_ids": ["<배경 문서 page ID>"]
    }
  }
}
```

읽기 이외에 issue 생성 및 해당 공간의 page 생성 권한이 필요하다. scoped 토큰은 각 API에 요구되는 scope도 필요하며 scope가 실제 공간 접근 권한을 대신하지 않는다.

AI가 기존 `request create`로 만든 **아직 승인하지 않은 DRAFT**를 게시하는 예:

```sh
node tools/harness-cli/index.js atlassian queue-ticket draft-work --ticket feature-demo
node tools/harness-cli/index.js atlassian preview
# 사용자가 사이트, 프로젝트, 제목/본문 등 실제 payload를 확인하고 게시를 승인한 뒤:
node tools/harness-cli/index.js atlassian sync --approve <방금 preview의 approval_digest>
node tools/harness-cli/index.js atlassian status
```

`queue-*`는 로컬 저장만 한다. `sync`만 외부 생성 요청을 한다. payload가 바뀌면 예전 digest는 거절된다.
같은 티켓을 수정한 뒤 재등록해도 새 이슈를 조용히 만들지 않는다. 이미 큐에 들어간 내용과 다르면 기존 이슈를 확인하도록 중단한다.
생성 성공 후 같은 DRAFT에 연결한다. 상세 계획과 티켓 ID를 다시 만들 필요가 없다:

```sh
node tools/harness-cli/index.js atlassian link draft-work --ticket feature-demo
node tools/harness-cli/index.js request show draft-work
# 사용자가 연결된 티켓과 계획을 확인하고 실행을 승인한 후:
node tools/harness-cli/index.js request approve draft-work
```

`link`는 생성 응답이 확인된 게시 기록과 원격 marker/제목/본문/중요도를 확인하고 Jira source를 연결한다. 구현·테스트 계획, 의존성, 기본 3회 시도를 보존하며 승인 지문은 새로 계산한다. **여전히 DRAFT**이므로 게시 승인이 실행 승인을 대신하지 않는다. 여러 티켓이면 각각 link한다.
게시 후 로컬 계획이나 Jira 입력이 달라졌다면 자동 연결을 거부한다. 이 경우 새 request ID로 import하여 바뀐 요구사항을 반영하고 다시 검토한다. 이미 게시한 티켓을 수정했다고 중복 이슈를 생성하지 않는다. priority ID 매핑은 게시할 P0/P1/P2/P3별로 한 개를 선택해야 한다.
이슈 유형별 필수 custom field가 있는 사이트는 현재 기본 생성 payload가 거절될 수 있다. 이때 Jira 화면에서 이슈를 만든 후 import하는 경로를 쓴다.

결과 게시에는 AI가 소스/로그를 통째로 올리지 않고 공개 범위를 검토한 다음 요약 JSON을 만든다:

```json
{
  "title": "demo 기능 구현 결과",
  "request_id": "demo-work",
  "ticket_id": "jira-10001",
  "summary": "변경 전후, 실제 검증 명령/결과, 재시도 이유, 남은 위험, 사용자 검수 여부를 실제 근거로 기재. 아직 Git 반영하지 않았으면 명시."
}
```

```sh
node tools/harness-cli/index.js atlassian queue-result --project demo --file "<요약 JSON 절대 경로>"
node tools/harness-cli/index.js atlassian preview
node tools/harness-cli/index.js atlassian sync --approve <사용자가 확인한 digest>
```

결과는 부모 페이지 아래 **새 페이지로 추가**한다. 기존 페이지 덮어쓰기/자동 수정은 지원하지 않아 타인의 수정과 버전 충돌을 피한다. 같은 요약은 큐에서 중복 억제하며, 다른 요약은 별도 기록이다.
비밀값 자동 탐지만 믿지 말고 payload를 확인한다. 게시용 요약은 검증 결과의 진위를 자동 보증하지 않는다.

칸반 상태 변경도 별도의 게시 승인으로 수행한다. 대상 사이트에서 확인한 **status ID**를 입력하며 transition ID와 혼동하지 않는다:

```sh
node tools/harness-cli/index.js atlassian queue-status --project demo --issue DEMO-1 --status-id <대상 status ID>
node tools/harness-cli/index.js atlassian preview
node tools/harness-cli/index.js atlassian sync --approve <승인한 digest>
```

현재 상태에서 사용 가능한 transition이 하나로 정해질 때만 큐에 넣고, 이미 대상 상태라면 UNCHANGED로 끝낸다. 승인 후 이슈 상태/수정 시각이 바뀌면 변경 요청을 거부한다. 필수 transition 화면 필드가 있는 경우 Jira UI를 이용한다.
상태 변경의 응답을 잃은 경우 reconcile은 원격 현재 상태가 대상과 같은지 확인한다. 이것이 해당 변경을 하네스가 수행했다는 감사 증명은 아니다. API의 최종 상태 읽기와 POST 사이를 서버 트랜잭션으로 묶지는 못한다.

| 상태 | 의미 / 다음 행동 |
| --- | --- |
| PENDING | 로컬 대기. preview 확인 후 sync |
| SYNCED | 생성 응답 또는 원격 marker 대조로 기록 확인. remote_id로 화면 확인 |
| REJECTED | 명시적인 HTTP 거절. 권한/요청/제한을 해결한 후 retry-rejected로 재대기하고 **새 digest** 승인 |
| SENDING / NEEDS_RECONCILIATION | 실행 중 중단/응답 유실 등으로 생성 여부 불확실. 자동 POST 재전송 금지 |

```sh
node tools/harness-cli/index.js atlassian retry-rejected <entry-id> --approve <동일 entry-id>
node tools/harness-cli/index.js atlassian preview
node tools/harness-cli/index.js atlassian reconcile <entry-id> --remote-id <확인한 숫자 원격 ID>
```

reconcile은 GET으로 marker와 프로젝트/부모 위치를 대조한다. 단순히 아무 ID나 연결하지 않는다.
불확실한 요청의 원격 기록을 찾지 못한 경우 무조건 다시 보내지 말고 관리 화면/감사 로그로 생성 여부를 먼저 확인한다. 자동 '미생성 증명' 기능은 없다.

## 11. 이력 검색과 다음 대화에서 재개

```sh
node tools/harness-cli/index.js history list --project demo
node tools/harness-cli/index.js history search --project demo --status REVIEW_READY --priority P1 --query "결제" --from 2026-09-01 --to 2026-09-30
node tools/harness-cli/index.js history search --project demo --kind ATTEMPT --status FAILED
node tools/harness-cli/index.js history export --project demo
node tools/harness-cli/index.js history status
```

`list`는 현재 로컬 원본 상태, `search/export`는 보존한 이전 스냅샷도 포함한다. 같은 티켓의 이전 상태가 검색되는 것은 최신 상태 덮어쓰기가 아닌 이력 보존이다.
필터는 project/request/ticket/status/priority/kind/technology/query/from/to다. 기간은 UTC이며 날짜만 입력한 `to`는 해당 날짜 끝까지 포함한다. 기술 필터는 등록 시 탐지한 stack 기준이다.
기존 프로젝트 archive 티켓은 `LEGACY_TICKET`이고 파일 mtime은 완료 시각으로 간주하지 않는다. 없는 검증/승인은 unknown이다. `list`로 미리 확인한 후 `history refresh`로 스냅샷을 가져올 수 있으며 동일 내용은 중복 저장하지 않는다.
원본 경로 및 remote_records의 게시 상태도 확인한다. 손상된 JSON/조회 실패는 빈 성공 목록으로 숨기지 않는다.

사용자의 실제 검수 결정을 기록하는 명령:

```sh
node tools/harness-cli/index.js history review --project demo --request demo-work --ticket jira-10001 --fingerprint <실행 기록의 현재 지문> --result accepted --reason "사용자가 확인한 내용"
# 수정 요청이면 --result changes-requested
```

현재 worktree의 지문이 달라지면 거부한다. 관리형 commit/push/merge에는 해당 티켓의 **최신** 검토가 `accepted`여야 한다. 승인 요청 뒤라도 `changes-requested`가 기록되면 이전 릴리스 승인은 실행할 수 없고, 재검토 수락과 새 승인 요청이 필요하다. 이 검토 기록은 별도의 Git 승인/반영을 대신하지 않는다.
`.harness/local/history/ledger.json`에는 관리형 명령의 시작 의도와 성공/실패, 티켓/시도/검증/릴리스 근거를 보존한다.
프로세스 강제 종료 시 STARTED가 남을 수 있다. `history refresh`는 원본 상태에서 누락 스냅샷을 복원하지만 실제 성공 여부를 추측해 STARTED를 성공으로 바꾸지 않는다.
하네스를 거치지 않은 모든 외부 파일 수정/명령을 감시하는 도구는 아니다.

원격 자료는 별도 조회한다:

```sh
node tools/harness-cli/index.js atlassian search --project demo --query "결제"
node tools/harness-cli/index.js atlassian context demo
node tools/harness-cli/index.js project context demo --bundle --json
```

Jira/Confluence 결과를 구분하고, 최대 10페이지를 넘으면 truncated를 표시한다. 원격 검색에는 `--jira-status "In Progress"`, `--jira-priority P1`, `--from YYYY-MM-DD`, `--to YYYY-MM-DD`를 추가할 수 있다.
중요도는 priority_map의 실제 ID로 변환한다. 기간은 Jira updated / Confluence lastmodified에 적용하고 to 날짜를 포함한다. 원격 날짜 해석은 계정/API 시간대의 영향을 받으며 로컬 history의 UTC 경계와 다르다. Jira 상태/중요도는 Confluence 검색에 적용하지 않는다.
배경 페이지는 지정한 ID만 가져와 ID/version/조회시각을 저장한다. 새 대화에서도 프로젝트별 최근 이력 최대 12개 및 해당 페이지를 크기 제한 안에서 읽는다.
원격 자료는 cached snapshot이며 최신 원격 버전이나 코드와의 의미적 일치를 자동 보장하지 않는다. 작업 전에 `atlassian context`로 갱신하고 변경 사항을 검토한다.
프로젝트 context에는 등록 당시 branch와 현재 Git 진단을 구분하고 승인 profile 이후 로컬 문서 변경을 표시한다. 모든 문서는 untrusted 입력이며 승인/비밀값 권한을 부여하지 않는다.

## 12. 공급자 계정 사용량

`.env.local`에 **조회 전용 관리자 자격증명**을 필요할 때만 설정한다:

```dotenv
OPENAI_ADMIN_KEY=<OpenAI organization admin key>
ANTHROPIC_ADMIN_KEY=<Anthropic Admin API key>
```

```sh
node tools/harness-cli/index.js provider account-usage --provider openai --from 2026-09-01 --to 2026-09-18
node tools/harness-cli/index.js provider account-usage --provider anthropic --refresh
```

기본 조회는 완료된 UTC 날짜 기준 최근 7일, 최대 90일이다. `to`는 그 날짜 00:00 UTC **미포함 경계**이며 당일 집계는 포함하지 않는다. history 기간 필터와 구분한다.
사용량과 비용은 각각 조회하며 한쪽 실패가 다른 쪽의 정상 데이터를 지우지 않는다. 최대 20페이지, 페이지당 256KB, 요청당 15초로 제한한다. 반복 cursor/불완전 응답은 부분 합계를 정상 합계로 내지 않는다.
계정 키/조회 기간별 5분 캐시를 사용한다. 키 자체는 저장하지 않고 캐시 식별에 해시만 사용한다. 조회에는 모델 추론 호출을 사용하지 않는다.

- OpenAI: 조직 completions 토큰과 조직 비용. 전체 API 제품의 모든 토큰이나 ChatGPT 구독 잔여량과 다르다.
- Anthropic: 조직 messages 사용량/비용. 비용의 USD cents를 dollar로 변환한다. Claude 구독 잔여량이 아니다.
- Gemini: Google Cloud Monitoring의 프로젝트 단위 완료 API 요청 수(`requests`). 실패 요청도 포함하며 토큰 수나 무료 한도 잔여량이 아니다. 빈 시계열은 `no-data/null`, 실제 0 포인트는 `available/0`으로 구분한다.
- 실제 잔액: 이 명령에서는 unknown. `provider usage`의 설정 예산 대비 로컬 관측 잔여량과 혼동하지 않는다.
- missing-admin-credential: 일반 모델 API 키를 넣어도 대신 사용하지 않는다. permission-denied는 계정/관리자 권한을 확인한다.

공식 계약: [OpenAI Usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage), [Anthropic Usage and Cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api). 실제 계정 호출은 이번 검증에서 수행하지 않았다.

### 12.1 OpenAI·Anthropic·Gemini 연결과 전환

`.env.local`의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`에 사용할 키만 설정한다. 모델은 각각 `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`로 지정한다. 이 작업에서 기본 모델명을 바꾸지는 않았다.

```sh
node tools/harness-cli/index.js provider check
node tools/harness-cli/index.js provider check --provider gemini
node tools/harness-cli/index.js provider use gemini
node tools/harness-cli/index.js provider status
```

`connected`는 모델 목록 읽기 권한 확인이다. 특정 모델 생성 성공, 잔액, 관리자 사용량 권한까지 보장하지 않는다. 목록 읽기를 제한한 키는 실제 생성 권한과 별개로 `permission-denied`일 수 있다. 전환은 하네스 API 실행 공급자에만 적용되며 현재 대화창의 AI나 구독을 전환하지 않는다. 키가 없는 다른 공급자는 `missing-key`로 남아도 사용 중인 공급자 결과를 가리지 않는다.

공식 모델 목록 계약: [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic](https://platform.claude.com/docs/en/api/models/list), [Gemini](https://ai.google.dev/api/models).

### 12.2 Gemini 계정 요청 수 조회 (선택)

Gemini 일반 API 키만으로 Cloud Monitoring을 읽을 수는 없다. 해당 API 키가 속한 Google Cloud 프로젝트 ID와, 그 프로젝트에 Monitoring Viewer 권한을 가진 계정의 OAuth access token이 필요하다. 토큰에는 `monitoring.read` 등 공식 API가 요구하는 읽기 scope가 있어야 한다. IAM 권한·API 활성화·과금 설정은 자동 변경하지 않는다.

```dotenv
GOOGLE_CLOUD_PROJECT=<Gemini API 키가 속한 프로젝트 ID>
GOOGLE_CLOUD_ACCESS_TOKEN=<로컬에서 발급한 OAuth access token>
```

```sh
node tools/harness-cli/index.js provider account-usage --provider gemini
```

OAuth access token은 만료되므로 갱신한 값을 로컬 환경에 다시 설정해야 한다. 일반 Gemini API 키와 바꿔 넣으면 안 된다. `missing-monitoring-credential`은 위 두 값 누락, 401은 만료/잘못된 인증 가능성, 403은 API 활성화·읽기 권한·scope를 확인한다. 현재 CLI는 OAuth 로그인/토큰 자동 갱신을 수행하지 않는다.

조회 범위는 지정 프로젝트의 `generativelanguage.googleapis.com` 완료 요청으로, 다른 클라이언트가 같은 프로젝트에서 보낸 요청도 포함한다. Vertex AI/Google AI 구독 사용량을 합산하지 않는다. DELTA 요청 수를 API의 일별 `ALIGN_SUM`으로 모은 뒤 페이지 끝까지 합산한다. 중복·잘못된 단위·경계를 넘는 구간은 불완전한 합계를 내지 않고 실패 처리한다. 조회는 최대 20페이지/페이지당 500포인트이며 상한 초과 시 `unavailable`이다. 수집 지연은 최대 30분일 수 있다.

Gemini 비용은 별도 Billing export 연동이 없으므로 `not-configured/null`, 실제 잔액은 `unknown`이다. 이를 토큰 0개/잔액 0원으로 표시하지 않는다. 공급자마다 제공하는 조회 범위가 달라 세 회사 결과가 동일한 단위는 아니다.

공식 계약: [Google API metrics](https://docs.cloud.google.com/apis/docs/monitoring), [Cloud Monitoring timeSeries.list](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).

## 13. Telegram과 실무 재현 체크

BotFather에서 개인 봇을 만들고 본인이 봇에 먼저 메시지를 보낸 다음 대상 chat ID를 확인한다. `.env.local`의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`만 설정하며 토큰을 문서/티켓에 기록하지 않는다.
`runner`의 소규모 테스트 티켓으로 REVIEW_READY 알림 수신을 확인하고 실패하면 로컬 PENDING 상태/봇 접근 권한/네트워크를 확인한 뒤 `runner notify <request>`를 실행한다. notification 재전송은 개발 재시도가 아니다.

검증 근거와 남은 조건은 [실무 시나리오 검증표](project/PERSONAL_OPERATIONS_VALIDATION.md)에 기록한다.
새 PC/실계정/다른 OS 재현을 하지 않았으면 완료로 표시하지 않는다. 실데이터로 첫 실행할 때는 공개 가능한 작은 테스트 프로젝트부터 확인한다.

## 14. 작업과 외부 기록을 연결하는 운영 순서

이 절차의 명령은 AI가 사용자 대신 호출한다. 사용자는 계획·공개 범위·최종 결과를 확인한다.
기본은 **로컬 초안 + 건별 게시 승인**이다. 프로젝트별 최초 범위 승인을 저장하면 관리형 티켓 생성·상태 변경·결과 페이지 생성까지 자동 게시한다. 연결 설정만으로는 게시 권한이 생기지 않으며, 상시 실행 서비스나 Git 승인도 아니다.

### 14.1 Jira 상태 매핑 (프로젝트당 최초 1회)

```sh
node tools/harness-cli/index.js atlassian workflow --project demo
# 조회한 실제 상태 ID로 교체:
node tools/harness-cli/index.js atlassian workflow --project demo --running 11 --blocked 12 --review-ready 13 --completed 14
```

`REVIEW_READY`는 구현·테스트 종료 후 **사용자 검수 대기**다. Jira Done 범주를 지정할 수 없다.
`COMPLETED`는 현재 검증 지문에 대한 `history review ... --result accepted`가 있는 상태이며 Jira Done 범주만 허용한다. **커밋·푸시·배포 완료가 아니다.** 이 세 작업은 별도 승인/기록을 유지한다.
`CHANGES_REQUESTED`는 blocked 매핑, `VERIFYING`은 running 매핑을 사용한다. 사용자 변경 요청 이후 개발 재실행은 별도의 검토된 복구/요청 절차로 진행한다.
사이트가 검수용 상태를 제공하지 않으면 먼저 Jira 워크플로를 구성하거나 기존 진행 중 상태를 검수용으로 선택한다. 실제 이슈에서 가능한 transition이 없거나 필수 입력 화면이 필요한 경우 prepare에서 중단하므로 Jira 화면에서 처리 후 다시 확인한다.

### 14.2 자동 기록 및 누락 복구

Atlassian 연결 설정이 존재하면 API runner가 실행 시작·종료 때 follow-up을 캡처한다. CLI의 관리형 execution/release/history 흐름도 결과를 캡처한다. 대화형 AI가 직접 파일만 변경하고 관리형 명령을 생략한 작업까지 자동 수집하는 것은 아니다.

```sh
node tools/harness-cli/index.js operations audit --project demo
node tools/harness-cli/index.js operations repair --project demo
```

둘 다 로컬 실행·검수 근거에서 현재 follow-up을 재구성하고 게시 누락을 보여준다. 네트워크/모델/개발/테스트를 실행하지 않는다. `repair`는 누락된 초안을 복원하는 명시적 운영 별칭이다.
원본 실행 근거까지 유실된 경우에는 복구할 수 없다. 아직 게시하지 않은 지난 running 상태가 이미 review-ready로 진행됐으면 과거 상태를 나중에 게시하지 않고 최신 상태를 준비한다. 기존 게시 기록은 outbox에 남는다.

### 14.3 결과 설명과 컨텍스트 보충

상태, 시도 수, 검증 건수·성공 건수, 검증 지문은 자동 결과 초안에 포함한다. 소스코드, stdout/stderr, 실패 로그 및 비밀값을 포함할 수 있는 명령 인자는 자동 게시하지 않는다.
변경 이유·설계 결정·배경 변경의 의미를 하네스가 자동 추론했다고 주장하지 않는다. AI가 실제 코드를 보고 아래 설명을 작성하고 사용자가 공개 범위를 검수한다:

```json
{
  "before": "변경 전 동작",
  "after": "변경 후 동작",
  "rationale": "선택한 해결책과 이유",
  "context_changes": "다음 작업자가 알아야 할 프로젝트 배경 변경"
}
```

```sh
node tools/harness-cli/index.js operations annotate <confluence-result의 id> --file "<설명 JSON 경로>"
```

16KB 이하 JSON이며 위 네 필드만 허용한다. annotate는 로컬 작성일 뿐 승인이 아니다. 게시 준비 후에는 내용을 덮어쓸 수 없으며, 별도 후속 기록으로 남긴다. Confluence 기존 배경 페이지를 덮어쓰지 않고 결과 페이지에 추가한다. 이 페이지를 이후 컨텍스트로 사용할 때는 `atlassian map`의 context page 목록에 승인하여 등록하고 `atlassian context`로 가져온다.

### 14.4 외부 반영

```sh
node tools/harness-cli/index.js operations prepare <jira-status의 id>
node tools/harness-cli/index.js operations prepare <confluence-result의 id>
node tools/harness-cli/index.js atlassian preview
# 사용자가 정확한 대상/본문/상태 변경을 승인한 뒤:
node tools/harness-cli/index.js atlassian sync --approve <approval_digest>
node tools/harness-cli/index.js operations audit --project demo
```

prepare는 Jira 현재 상태/가능한 transition 등을 읽고 기존 게시 outbox에 넣는다. Confluence 요약은 로컬 임시 JSON을 생성하여 큐에 넣는다. 동일 follow-up을 여러 번 prepare해도 개발·게시가 중복 실행되지 않는다. 이미 목표 Jira 상태라면 GET 결과를 관측 기록으로 남기며 POST하지 않는다.
코드 지문·검수 상태·게시 대상이 바뀐 초안은 게시를 거절한다. preview는 아직 제출하지 않은 오래된 follow-up을 SUPERSEDED로 바꾼다. 바뀐 코드라면 재검증/재검수를 먼저 하고 repair/prepare/preview로 새 승인을 받아야 한다. 외부 문서 변경도 제출 전 Jira 입력 재조회로 점검한다.

| audit 결과 | 다음 행동 |
| --- | --- |
| MISSING | prepare → preview → 사용자 게시 승인 |
| PENDING | preview의 정확한 payload를 확인하고 sync |
| SYNCED | 생성 응답 또는 목표 상태 관측 기록 존재. 매번 원격 내용 전체를 감사했다는 뜻은 아님 |
| REJECTED | 원인을 수정하고 atlassian retry-rejected → 새 preview 승인. 개발 재실행 금지 |
| SENDING / NEEDS_RECONCILIATION | 원격 결과가 불확실함. marker/remote ID로 reconcile 후 처리; 자동 재POST 금지 |

네트워크 실패는 코드를 다시 개발할 이유가 아니다. follow-up만 재처리하고 runner의 시도 수는 그대로 유지한다.

### 14.5 실계정 운영 리허설과 검증 수준

2026-09-21 개인 테스트 계정에서 합성 티켓·문서 생성, 조회, 상태 전이와 관리형 응답 보정을 검증했다. 이는 아래의 전체 요청-실행-검수-결과 게시 절차를 완료했다는 뜻이 아니다.
개인 테스트 프로젝트/Confluence 부모 페이지/Telegram 수신 대상을 지정하고 회사 자료 업로드 정책을 확인한다. 실제 키는 로컬에만 둔다.
작은 티켓 하나를 create → 게시 승인/sync → link → 계획 승인 → prepare/run → 알림 확인 → follow-up 게시 승인 → 사용자 검수 → 완료 상태 게시까지 진행한다. Jira 화면, Confluence 페이지, Telegram 수신을 각각 확인하여 기록한다. Git 작업은 승인하지 않았다면 실행하지 않는다.
다른 OS·실제 모델 성능·새 사용자의 가이드 재현 및 업무 시간 절감률은 별도 측정 대상이다.

2026-10-02에는 승인된 합성 티켓 2개를 생성·연결하여 실제 개인 Jira에서 진행 중/검토 중/완료로 이동하고, 결과 페이지 2개를 Confluence에 게시·재조회했다. 실제 Git/HTTP/새 control-root 복원도 검사했지만 모델 응답·사용자 검수 판단·알림 전달은 fixture다. standing-consent 전체 자동 기록, 실제 새 사용자·새 PC 및 업무 시간 측정 완료를 뜻하지 않는다. [실행 기록](project/OPERATIONS_REHEARSAL_VALIDATION.md)과 [검수·측정·복원 가이드](OPERATIONS_EVIDENCE_GUIDE.md)를 따른다.

### 14.6 한 번 승인하고 자동 기록하기

connect/map/workflow 설정 후, AI가 다음 preview의 실제 사이트·프로젝트·공간·상위 페이지와 공개 범위를 사용자에게 보여준다. **사용자가 그 범위를 승인했을 때만** grant를 실행한다. AI가 digest를 만들었다는 사실 자체는 사용자 승인이 아니다.

```sh
node tools/harness-cli/index.js atlassian consent preview --project demo
node tools/harness-cli/index.js atlassian consent grant --project demo --approve <scope-digest>
node tools/harness-cli/index.js atlassian consent status --project demo
```

- 승인 범위: 해당 프로젝트의 관리형 DRAFT 티켓 본문·계획·검증 명령, 근거가 있는 상태 변경, 결과 요약/작성된 설명의 **새 Confluence 페이지** 생성. 회사 자료를 개인 공간으로 보내도 되는지는 별도로 확인한다. 티켓·설명에 키나 비밀값을 적지 않는다.
- 제외: 임의 JSON 게시, 기존 페이지 덮어쓰기·삭제, raw 로그 자동 전송, 계획 실행 승인, 사용자 검수, Git commit/push/merge.
- 사이트/계정 이메일/프로젝트/공간/부모 페이지/워크플로·우선순위 매핑 등이 달라지면 기존 승인은 사용할 수 없다. 새 preview를 확인하고 다시 승인한다. 동일 계정의 API 토큰 교체는 재승인 사유가 아니다.
- 승인 기록은 로컬 `.harness/local/atlassian/consents.json`에 저장된다. 새 PC로 자동 이동하지 않는다. 로컬 파일을 신뢰하는 관리형 경계이지 OS 수준 보안 장벽은 아니다.

승인 후 `request create/revise/priority/approve`, `execution prepare/advance/review-ready`, `runner run`, `history review`의 관리형 CLI 흐름에서 기록 후속 작업을 자동 시도한다. runner는 시작 상태도 전달한다. 조회·검색만 해서는 게시하지 않는다. 새 Jira 티켓은 같은 로컬 DRAFT에 연결되며 **계획 승인은 별도**다. 연결 시 지문이 갱신되므로 승인 전에 최신 `request show`를 확인한다.

수동 재개 또는 연결 이전의 티켓을 기록하려면:

```sh
node tools/harness-cli/index.js operations flush --request <request-id>
node tools/harness-cli/index.js operations flush --project demo
node tools/harness-cli/index.js operations audit --project demo
```

`--request`는 지정 요청의 미연결 DRAFT도 생성/연결한다. `--project`는 기존 실행의 후속 기록만 처리하고 오래된 DRAFT를 전부 게시하지 않는다. 1회 최대 20개 항목을 처리하며, 남은 항목은 다시 flush한다. 모델 추론·개발·테스트를 재실행하지 않는다.

자동 게시된 결과는 사실 기반 요약이다. 상세 before/after 설명은 게시 전 annotate하거나 별도 queue-result와 건별 승인으로 추가한다. 자동 게시가 끝난 페이지를 나중에 조용히 수정하지 않는다.

오프라인에서는 게시하지 않는다. REJECTED는 원인을 확인하고 명시적으로 retry-rejected로 다시 큐에 넣은 뒤 flush한다. SENDING/NEEDS_RECONCILIATION은 응답 유실일 수 있어 자동 재POST하지 않는다. 같은 이슈의 불확실한 이전 상태 변경도 먼저 reconcile해야 한다. 기록 실패는 경고/누락 내역으로 남고 개발 성공을 실패로 바꾸지 않는다.

즉시 이후 게시를 중지하려면:

```sh
node tools/harness-cli/index.js atlassian consent revoke --project demo
```

전송 직전에도 승인을 재확인한다. 이미 서버로 전송된 요청까지 취소하거나 되돌리지는 못한다. scope 밖의 수동 게시에는 기존 preview/sync 건별 승인이 필요하다.

이번 확인은 사용자 요청에 따라 **모의 HTTP/임시 로컬 상태만 사용**했다. 실제 계정 권한, 사이트별 워크플로와 수신 화면은 아직 검증하지 않았다.

## 운영 현황과 검수 대기

`dashboard`는 기본적으로 로컬 읽기 전용이다. 외부 연결 진단은 `--check-connections`, 알림 전송은 `--notify`로 명시한다. 코드 반영과 운영 수락을 구분하는 `review` 티켓, 복구 안내, 선택형 관측 비용은 [운영 현황 가이드](OPERATIONS_STATUS.md)를 참고한다.


## Project-scoped notification headers

Telegram messages and Slack titles begin with the explicit project ID, for example
`[steam-project] [PASS] Task: jira-10074` or `[harness-template] [FAIL] Task: notification-project-prefix`.
Managed request/execution/release notifications use their ticket project IDs; runner outcome
retries retain the ticket project. Combined operations list all relevant IDs. If managed
operation context cannot be resolved, the header is `[unknown-project]`, not an inferred project.
These headers identify the project; PASS/REVIEW_READY does not grant user acceptance or Git approval.
