# Atlassian MCP 우선 연결

## 역할 분리

검색, 문서 조회/생성/수정, 관련 객체 탐색과 문서 관계 관리는 Atlassian MCP가 담당한다. 하네스는 별도 문서 관리 시스템을 만들지 않는다.
하네스에 남기는 것은 로컬 프로젝트와 원격 ID 매핑, 실행에 사용한 문서의 버전/크기 제한/비신뢰 표시, 계획/검수/Git 승인, 실행 근거와 중복 게시 방지다.

## 두 가지 사용 환경

**대화형 AI에 이미 MCP가 연결된 경우:** AI가 그 MCP로 검색·관련 문서 탐색·본문 조회를 수행한다. 로컬 CLI가 대화창의 로그인이나 MCP 연결을 자동 공유하는 것은 아니다. 단순 탐색 때문에 REST 키를 추가하거나 검색 클라이언트를 다시 만들 필요가 없다. 단, host에서 직접 쓴 결과가 자동으로 하네스의 SYNCED/검증 근거가 되지는 않는다. 관리형 게시·실행은 아래 CLI 경로를 사용하거나 별도 검증된 host adapter가 필요하다. 현재 이 저장소에는 host adapter 자동 연결이 없다.

**독립 Node CLI/API runner:** Streamable HTTP MCP를 통해 기존 관리형 명령을 실행한다. 공식 MCP의 API-token 인증을 조직 관리자가 허용한 계정이어야 한다. host OAuth 세션 공유, OAuth 로그인/토큰 갱신, stdio MCP, MCP elicitation/sampling, 임의 MCP 서버는 이번 범위에 포함하지 않는다.

## 최초 설정: AI가 도구 스키마를 확인한다

```sh
node tools/harness-cli/index.js atlassian connect --site https://your-site.atlassian.net --cloud-id <cloud-id>
node tools/harness-cli/index.js atlassian mcp-tools
```

기본 `transport`는 `mcp`다. `.env.local`의 `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`을 사용하며, 고정된 공식 서버 `https://mcp.atlassian.com/v2/mcp?tools=all`에만 전송한다. 토큰을 티켓/매핑/대화에 넣지 않는다. 키가 없으면 연결이 끝났다고 표시하지 않는다.

`mcp-tools`는 현재 계정의 실제 `tools/list` 스키마를 읽는다. 실제 도구 이름·인자·응답은 권한과 서버 버전에 따라 달라질 수 있으므로 추측한 기본 매핑으로 쓰기 요청을 보내지 않는다. AI는 읽기 도구로 응답 형태를 확인한 다음 `.harness/local/atlassian.json`의 `mcp.bindings`를 작성한다. 쓰기 매핑은 범위 승인 전에 사용자에게 설명한다.

다음은 **문법 예시이며, 실제 서버 계약을 검증한 기본값이 아니다.** 도구가 `cloudId`/`id`를 받고 기존 페이지 구조를 그대로 반환하는 것을 확인한 경우에만 맞는다:

```json
{
  "transport": "mcp",
  "site": "https://your-site.atlassian.net",
  "cloud_id": "00000000-0000-0000-0000-000000000000",
  "jira_projects": { "demo": "DEMO" },
  "mcp": {
    "bindings": {
      "confluence.getPage": {
        "tool": "getConfluenceContent",
        "arguments": {
          "cloudId": { "$ref": "/cloudId" },
          "id": { "$ref": "/id" }
        }
      }
    }
  }
}
```

매핑 입력은 `operation`, `site`, `cloudId`, `id`, `query`, `payload`다. `$ref`는 JSON pointer이며 문자열 결합/코드 평가/파일 접근을 지원하지 않는다. `result`를 생략하면 `structuredContent` 또는 단일 JSON text를 그대로 기존 검사기에 전달한다. 응답에 wrapper가 있다면 `"result": { "$ref": "/data" }`처럼 선택하거나 필드를 재배치한다. 원격 ID·공간·버전·본문·Jira 입력 지문 검사는 그대로 실행된다. 매핑 자체는 신뢰하는 로컬 adapter 설정이므로 실제 도구의 목적지 필드와 승인된 목적지가 일치하는지 검증해야 한다.

주요 작업 키:

| 작업 | 매핑 키 |
| --- | --- |
| 문서 본문/배경 읽기 | `confluence.getPage` |
| 공간·문서 목록 | `confluence.getSpace`, `confluence.listSpaces`, `confluence.listPages` |
| 문서 검색/결과 새 페이지 | `confluence.search`, `confluence.createPage` |
| Jira 입력 읽기/생성 | `jira.getIssue`, `jira.createIssue` |
| 상태 조회/변경 | `jira.getStatus`, `jira.listTransitions`, `jira.transitionIssue`, `jira.projectStatuses` |
| Jira 설정·검색 | `jira.currentUser`, `jira.getProject`, `jira.listProjects`, `jira.getPriority`, `jira.listPriorities`, `jira.search` |

지원 도구가 없으면 해당 자동화는 중단한다. 억지로 다른 쓰기 도구에 연결하거나 REST로 자동 fallback하지 않는다. 문서 관계 탐색/추가는 host의 `getTeamworkGraphContext` / `addTeamworkGraphContext` 등 실제 지원 도구를 사용하며, 이를 별도 하네스 관계 데이터베이스로 복제하지 않는다.

## 기존 안전 경계

- 관리형 쓰기는 `createJiraIssue`, `transitionJiraIssue`, `createConfluenceContent`만 허용한다. 문서 덮어쓰기·삭제·권한 변경을 기존 게시 승인에 추가하지 않는다.
- preview/standing consent는 연결 방식과 매핑에도 결속된다. REST에서 MCP로 바꾸거나 매핑이 바뀌면 이전 승인을 재사용하지 못한다.
- 쓰기 전 도구 매핑/가용성을 확인한다. 미설정 상태에서는 큐가 PENDING으로 남는다. 실제 쓰기 응답이 유실되면 NEEDS_RECONCILIATION이며 자동 재전송하지 않는다.
- MCP 서버가 오류를 반환하거나 성공했다고 서술만 하면 성공으로 기록하지 않는다. 필요한 구조화 응답과 원격 ID가 있어야 한다.
- 요청당 15초/응답 256KB, 도구 목록 최대 20페이지. SSE와 JSON을 지원하며 원격 리다이렉트를 따르지 않는다. 세션 만료/서버 요청 개입 시 자동 쓰기 재시도 대신 중단한다.
- MCP 연결은 계획 승인·사용자 검수·커밋/푸시 승인과 별개다. 대화형 AI가 MCP를 직접 호출하는 것까지 OS 차원에서 차단하지는 않는다.

## 기존 REST 사용자가 선택적으로 유지하는 방법

```sh
node tools/harness-cli/index.js atlassian connect --site https://your-site.atlassian.net --transport rest
```

REST는 호환용 명시적 선택이다. transport가 없는 오래된 설정도 이제 MCP로 해석되므로 기존 REST를 계속 쓰려면 위처럼 명시해야 한다. 키가 있다고 자동으로 REST로 돌아가지 않는다.
기존 outbox/승인/이력은 삭제하지 않는다. 운송 경로가 바뀐 pending/uncertain 항목은 원래 경로로 확인·정산한 뒤 새 경로에서 새 승인으로 작업한다. 오래된 항목의 connection 정보를 손으로 바꿔 승인을 우회하지 않는다.

## 검증 범위

모의 MCP 서버에서 initialize → tools/list → tools/call, JSON/SSE, 세션 헤더, Jira 입력 재조회, 승인형 티켓/상태/결과 기록, 오류·응답 유실·재진입을 검증한다. **실제 계정 연결·실제 도구 인자/응답 매핑 검증은 아직 수행하지 않았다.** 모의 서버의 예제 스키마를 실서버 스키마라고 주장하지 않는다.

공식 참고: [지원 도구](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/), [API-token 인증](https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-authentication-via-api-token/), [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
