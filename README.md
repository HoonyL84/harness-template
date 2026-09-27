# Harness Engineering Template

AI가 여러 소프트웨어 프로젝트에서 작업할 때 계획, 실행, 검증, 기록, Git 반영을 분리하는 개인 개발용 운영 템플릿입니다. 코드를 대신 판단하는 제품이 아니라, AI가 만든 작업을 사람이 검토하고 재현 가능한 근거와 함께 관리하기 위한 도구입니다.

## 무엇을 해결하나

- 여러 Git 프로젝트를 하나의 CLI에 등록하고 프로젝트별 컨텍스트와 작업 이력을 구분합니다.
- 요청을 티켓과 검증 계획으로 정리한 뒤, 사용자 승인 전에는 관리형 실행을 시작하지 않습니다.
- 실행 전 원본 프로젝트의 미커밋 상태를 확인해 작업 내용이 누락된 채 실행되는 것을 방지합니다.
- 격리된 Git worktree에서 실행하고 테스트 결과, 실패 사유, 재시도 횟수와 검수 대기 상태를 남깁니다.
- commit, push, merge는 각각 대상과 콘텐츠 지문에 결속된 별도 승인이 있어야 관리형 명령으로 실행합니다.
- 완료된 작업의 기술·문제·검증 근거를 검색 가능한 이력과 경력 근거 초안으로 보존합니다.

하네스는 모든 AI 파일 쓰기나 일반 `git` 명령을 운영체제 수준에서 차단하는 보안 샌드박스가 아닙니다. 또한 테스트 통과만으로 구현의 의미적 정확성을 보증하지 않습니다. 요구사항과 테스트의 적합성, 최종 코드 및 릴리스 판단은 사용자가 검수해야 합니다.

## 시작하기

Node.js 24, npm, Git이 필요합니다. Windows, macOS, Linux에서 같은 Node CLI를 사용합니다.

```bash
git clone https://github.com/HoonyL84/harness-template.git
cd harness-template
npm install
npm run harness -- check
```

`check`는 `.env.local`이 없으면 `.env.template`에서 생성합니다. API 키는 선택 사항이며, 사용할 때만 `.env.local`에 넣습니다. 키를 Git에 커밋하거나 티켓·문서·대화에 기록하지 마세요. Windows PowerShell에서 `npm` 실행 정책 오류가 나면 `npm.cmd run harness -- check`를 사용합니다.

기존 프로젝트를 등록하는 기본 흐름:

```bash
npm run harness -- project add sample --path "/absolute/path/to/project"
npm run harness -- project onboard sample
# AI가 제안한 프로젝트 프로필과 검증 명령을 확인한 뒤
npm run harness -- project onboard sample --approve
npm run harness -- project context sample --bundle
```

아직 Git HEAD가 없는 새 프로젝트는 별도의 승인형 `bootstrap` 흐름을 사용합니다. 실제 프로젝트 연결, 대화형 AI와 API 키 실행의 차이, 최초 설정과 실패 시 조치는 [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)에 단계별로 정리했습니다.

## 작업 흐름

1. 사용자가 프로젝트와 목표를 말하면 AI가 범위, 티켓, 의존성, 수용 기준과 테스트 계획을 제안합니다. 하네스 CLI는 계획 형식과 프로젝트 경계를 검사하지만, 계획의 품질 자체는 보증하지 않습니다.
2. 사용자가 중요도와 범위, 기본 최대 3회의 시도 정책을 검토하고 계획을 승인합니다. 같은 오류가 반복되거나 한도를 소진하면 중단하고 근거를 남깁니다.
3. 실행 결과는 검증과 별도 검수 단계로 이동합니다. 실패와 검수 대기는 설정된 알림 채널에 통지할 수 있습니다.
4. 사용자가 diff와 테스트 결과를 검수하고 결과를 수락한 뒤 commit, push, merge를 각각 승인합니다. 승인 이후 콘텐츠가 바뀌면 기존 승인은 사용할 수 없습니다.
5. 티켓·배포·작업 이력을 프로젝트와 기간으로 검색하고, 확인된 근거만 외부용 경력 기록에 사용합니다.

명령의 전체 예시는 [사용 가이드](docs/HARNESS_GUIDE.md), 운영 시나리오는 [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)를 참고하세요.

## 선택형 연동

| 연동 | 현재 범위 |
| --- | --- |
| 대화형 AI | Codex, Claude Code 등에서 규칙 문서와 CLI를 함께 사용. 대화형 호스트의 로그인·토큰은 하네스 API 키와 별개 |
| 모델 API | OpenAI, Anthropic, Gemini를 선택적으로 연결. 하네스가 관측한 토큰 사용량과 설정 예산을 조회할 수 있으나 계정 전체 잔액은 알 수 없음 |
| Atlassian | Jira 이슈와 Confluence 문서의 조회·게시·상태 기록을 MCP 우선 방식으로 연결. REST는 명시적 호환 선택. 모의 서버와 개인 테스트 계정의 제한된 합성 시나리오를 검증했으며, 계정별 도구 매핑은 확인이 필요 |
| 알림 | 설정된 Telegram 또는 Slack으로 상태 변화와 실패·검수 대기 알림 |
| 멀티에이전트 | 역할 분리와 격리 실행은 기본 비활성화된 선택형 실험 기능 |
| L4.5/L5 | 저위험 자동 수정과 예산 제한 자율 루프는 opt-in. 고위험 변경 및 Git 반영은 승인 경계를 유지 |

Jira 카드 이동만으로 코드가 자동 실행되거나 Confluence 내용이 무검토로 프로젝트 지시가 되지는 않습니다. [Atlassian 연결 경계](docs/ATLASSIAN_MCP.md)와 [실행 모드](docs/design-docs/execution-modes.md)에 지원 범위와 제한을 명시했습니다.

## 검증과 현재 한계

```bash
npm test
npm run coverage
npm run lint
npm run harness -- verify --full
```

Full 검증은 완료 게이트이며 Quick 검증은 개발 중 피드백용입니다. 기능 테스트와 모의 연동은 실제 프로젝트에서의 코드 품질을 보장하지 않습니다. 개인 테스트 계정의 제한된 합성 게시·조회는 확인했지만, 전체 실계정 운영 흐름과 공급자 관리자 API는 별도 검증이 필요합니다. 검증 수준은 [운영 시나리오 기록](docs/project/PERSONAL_OPERATIONS_VALIDATION.md)에서 구분합니다.

## 문서

- [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md): 설치, 프로젝트 등록, 티켓, 승인, 실패 복구, Jira/Confluence와 알림
- [전체 CLI 가이드](docs/HARNESS_GUIDE.md): 명령과 기존 단일 프로젝트 흐름
- [Atlassian MCP](docs/ATLASSIAN_MCP.md): 계정 연결, 도구 매핑, 읽기·쓰기 경계
- [에이전트 진입 규칙](AGENTS.md): 작업 원칙과 세부 문서 목차
- [설계·제약](docs/design-docs/): 실행 모드, 자동 수정, L5 정책, 역할 분리

템플릿의 예시 설정과 문서는 복제한 프로젝트에 맞게 검토·교체해야 합니다. 특히 검증 명령이 실제 제품 테스트와 빌드를 실행하는지 확인한 뒤 작업을 완료하세요.
