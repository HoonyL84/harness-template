# Harness Engineering Template

여러 프로젝트의 AI 개발 작업을 **계획 → 승인 → 격리 실행 → 검증 → 사람 검수 → Git 반영 → 이력**으로 관리하는 개인용 engineering control plane입니다.

무엇을 하기로 했는지, 어떤 결과를 검증했는지, 사람이 무엇을 승인했는지를 연결하여 반복 작업과 확인 누락을 줄입니다. AI는 계획과 구현을 제안하고, 하네스는 실행 근거를 관리하며, 사람은 최종 판단과 승인을 맡습니다.

- **왜 만들었나:** 프로젝트마다 반복되는 맥락 전달·작업 추적·검증 정리 → [해결하는 문제](#해결하는-문제)
- **어떻게 돌아가나:** 요청부터 상세 계획, 사람 검수와 Git 반영까지 → [실제 사용 흐름](#실제-사용-흐름)
- **코드는 어디 있나:** 책임별 핵심 모듈과 설계 절충 → [구현 위치와 설계 선택](#구현-위치와-설계-선택)

## 목차

- [해결하는 문제](#해결하는-문제)
- [구조와 책임 분리](#구조와-책임-분리)
- [설치와 프로젝트 등록](#설치와-프로젝트-등록)
- [실제 사용 흐름](#실제-사용-흐름)
- [승인과 변경 탐지](#승인과-변경-탐지)
- [격리 실행과 의존관계](#격리-실행과-의존관계)
- [컨텍스트와 모델 비용](#컨텍스트와-모델-비용)
- [Jira·Confluence·알림](#jiraconfluence알림)
- [기록 검색과 다른 PC](#기록-검색과-다른-pc)
- [실패와 복구](#실패와-복구)
- [테스트와 AI 품질 평가](#테스트와-ai-품질-평가)
- [구현 위치와 설계 선택](#구현-위치와-설계-선택)
- [지원 범위와 한계](#지원-범위와-한계)

## 해결하는 문제

대화창에 개발을 맡기는 것만으로는 프로젝트별 배경, 계획 수정, 검증 결과, 실패 이력과 Git 승인이 일관되게 남지 않습니다. 다음 작업이나 다른 대화에서 사람이 다시 맥락을 설명하고 이전 결과를 확인해야 합니다.

하네스는 그 반복 업무를 파일 기반의 재현 가능한 흐름으로 만듭니다.

| 사람이 하던 반복 업무 | 하네스가 지원하는 일 | 사람이 계속 책임지는 일 |
| --- | --- | --- |
| 프로젝트마다 배경과 검증 방법 설명 | 프로젝트 등록, 승인된 프로필, 선택 문서 번들 | 실제 업무 규칙과 검증 명령의 적합성 |
| AI가 제안한 작업을 정리하고 추적 | 상세 티켓·의존관계·테스트 계획·수정 근거 저장 | 요구사항 누락, 범위, 위험도와 우선순위 판단 |
| 작업 폴더/브랜치 준비, 테스트 실행 | 승인된 티켓별 worktree, 실행 기록, 제한된 재시도 | 고위험 변경 승인, 막힌 원인에 대한 결정 |
| Jira·문서·알림 상태를 수동 전달 | 동의한 범위의 후속 게시와 채널별 알림 | 외부 게시 범위와 회사 정보 반출 허용 여부 |
| 완료 내역을 다시 찾아 정리 | 프로젝트·기간·기술·티켓별 검색 및 근거 출력 | 최종 코드 검수, Git 반영과 공개 내용 승인 |

## 구조와 책임 분리

```text
사용자: 목표·제약 전달 / 계획·결과·Git 반영 승인
   |
대화형 AI 또는 선택형 모델 API: 자료 해석, 계획/패치 제안
   |
Harness Node CLI: 계약 검사, 상태·예산·승인·증거 관리
   |-- 프로젝트 A Git worktree / 승인된 검증 명령
   |-- 프로젝트 B Git worktree / 승인된 검증 명령
   |-- 로컬 컨텍스트·실행·검수·릴리스 원장
   `-- 선택형 Jira / Confluence / Telegram / Slack
```

- **AI**는 요청을 해석하고 상세 계획과 구현을 제안합니다.
- **하네스 코드**는 허용 프로젝트·경로·검증 명령·의존관계·승인 지문과 상태 전이를 검사합니다.
- **프로젝트 테스트/빌드**는 승인된 요구사항을 검증하는 근거입니다.
- **사람**은 요구사항 경계, 고위험 판단, 최종 수락과 릴리스 책임을 가집니다.

중앙 하네스와 관리 대상 프로젝트는 별도 저장소입니다. 기존 프로젝트에 하네스 전체를 복사하지 않아도 등록·프로필 승인으로 연결할 수 있습니다. 기존 단일 저장소 티켓 흐름도 유지합니다.

## 설치와 프로젝트 등록

필수 도구는 **Node.js 24, npm, Git**입니다. 같은 Node CLI를 Windows·macOS·Linux에서 사용합니다. 프로젝트 빌드 도구(Java, Godot 등)는 해당 프로젝트에서 별도로 준비합니다.

```bash
git clone https://github.com/HoonyL84/harness-template.git
cd harness-template
npm ci
npm run harness -- check
npm run harness -- help
```

`check`는 `.env.local`이 없으면 `.env.template`에서 생성합니다. 대화형 작업에는 모델 API 키가 필수가 아닙니다. PowerShell에서 `npm.ps1`이 차단되면 `npm.cmd` 또는 `node tools/harness-cli/index.js`를 사용합니다. 실행 정책을 전역으로 완화할 필요는 없습니다.

```bash
npm run harness -- project add sample --path "/absolute/path/to/project"
npm run harness -- project onboard sample
# 제안된 스택, 원본 Git 상태, 실제 테스트/빌드 명령을 사람이 확인
npm run harness -- project onboard sample --approve
npm run harness -- project context sample --bundle
```

원본 프로젝트에 미커밋 변경이 있거나 등록 때 확인한 기준점이 바뀌면 실행 준비를 막습니다. 변경을 버리는 대신 보존·정리하고 프로필과 계획을 다시 확인합니다. Git HEAD가 없는 새 프로젝트의 초기 커밋은 별도의 `bootstrap request/approve/apply` 승인 흐름으로 처리합니다.

설정은 `.harness/config.json`과 지원되는 환경변수/CLI 옵션을 사용합니다. 보호 경로의 최소 안전선은 설정으로 해제할 수 없습니다. API·알림 키는 `.env.local`에만 두고 커밋, 티켓, 문서나 채팅에 노출하지 않습니다.

## 실제 사용 흐름

예를 들어 사용자가 다음과 같이 요청합니다.

> 결제 실패 재시도 테스트를 보강하고, 광고 서버의 이벤트 처리도 관련 있으면 같이 확인해줘.

AI는 바로 두 프로젝트를 수정하지 않습니다. 프로젝트 문서와 코드를 확인하여 필요한 업무를 나누고, 이벤트 계약이나 재시도 규칙이 없으면 질문합니다. 사람에게는 **분배 요약·선행 관계·필수 질문**을 보여주되, 기록에는 티켓마다 아래 내용을 남깁니다.

| 계획에 남기는 내용 | 목적 |
| --- | --- |
| 목표, 범위, 제외 범위 | 요청하지 않은 변경을 구분 |
| 기존 사실과 출처, 제안, 미해결 질문 | 문서의 사실과 AI의 설계 제안을 구분 |
| 구현 단계와 대상 경로 | 실제 수행할 작업을 재현 가능하게 표현 |
| 수용 기준, 테스트 대상·조건·기대 결과, 검증 명령 | 무엇을 확인해야 완료인지 정의 |
| 중요도 P0~P3, 위험도·근거, 재시도 정책 | 사람이 실행 순서와 비용/위험을 조정 |
| Git 의존성, 문서 참조, 관련 티켓, 읽기 쉬운 라벨 | 선행 구현과 참고 관계를 혼동하지 않음 |

### 계획에서 실행까지

```text
입력 스냅샷 → 상세 초안 DRAFT → 계획 검수/수정 → APPROVED
                                               |
                                  실행 준비 PREPARED
                                               |
                                      RUNNING + 검증
                                       /          \
                                  BLOCKED      REVIEW_READY
                                                  |
                                       사람의 결과 수락
                                                  |
                           별도 Git 승인 → APPLYING → APPLIED
```

이는 흐름 요약입니다. 계획·실행·릴리스는 서로 다른 기록이며, `APPLIED`는 해당 Git 작업의 적용 상태이지 서비스 배포 완료가 아닙니다. 외부 실행 검증 중에는 `VERIFYING`, 선행 커밋이 없으면 `WAITING_DEPENDENCY` 같은 상태도 사용합니다.

표준 계획 경로는 다음과 같습니다. JSON 파일은 AI가 준비하고 사람이 내용을 승인합니다.

```bash
npm run harness -- request capture work-01 --input-file .harness/local/input.json
npm run harness -- request draft work-01 --output-file .harness/local/output.json
npm run harness -- request planning work-01
npm run harness -- request planning-review work-01 --review-file .harness/local/review.json
# 범위와 질문을 확인한 뒤 명시적으로 승인
npm run harness -- request approve work-01
npm run harness -- request ready work-01
npm run harness -- execution prepare work-01
```

`capture`는 요청·선택 자료·프로필의 스냅샷, `draft`는 출처와 계약을 검사한 계획, `planning-review`는 사람 평가 근거를 기록합니다. 필수 맥락/질문이 미해결이면 승인되지 않습니다. 검수 기록은 승인 자체가 아니며, 기존 `request create/revise` 경로도 호환을 유지합니다. 입력·출력 JSON 전체 계약은 [계획 품질 가이드](docs/PLANNING_QUALITY_GUIDE.md)에 있습니다.

**대화형 모드**에서는 현재 AI가 승인된 worktree에서 구현하고 `execution review-ready`로 프로젝트 검증을 수행합니다. **API 모드**에서는 키와 모델 설정 후 `runner run work-01 --ticket TICKET_ID`가 패치 생성·검사·적용·검증을 진행합니다. `runner run`을 대화형 호스트의 무료 토큰을 호출하는 명령으로 해석하면 안 됩니다.

`REVIEW_READY`는 구현과 지정된 검증이 끝나 **사용자 검수를 기다린다**는 뜻입니다. 기획/설계 티켓은 승인된 Markdown 산출물과 문서 구조를 검사하고, 내용의 품질은 사람이 검수하여 수락합니다.

### 결과 수락과 Git 반영

`history review --result accepted`에 현재 콘텐츠 지문과 검수 사유를 기록한 뒤, `release request`로 작업 종류·대상·메시지가 고정된 승인을 요청합니다. `release approve`와 `release apply`는 해당 승인을 확인하고 소비합니다.

**commit·push·merge는 별도 승인**이며, 계획 승인이나 Jira 상태 변경으로 허용되지 않습니다. 하네스 저장소의 main 반영은 PR·최신 필수 CI 통과·사용자 병합 승인을 따릅니다. 일반 Git 명령으로 정책을 우회하지 않습니다. 세부 명령은 [릴리스 안전 정책](docs/RELEASE_SAFETY.md)과 [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)를 따릅니다.

## 승인과 변경 탐지

Fingerprint는 승인한 입력과 실제 실행 대상이 달라졌는지 검사하는 SHA-256 기반 변경 탐지값입니다. 단일한 만능 해시가 아니라 목적별로 나뉩니다.

| 지문/기록 | 결속하는 주요 내용 | 변경되면 |
| --- | --- | --- |
| 계획·계획 근거 | 프로젝트, 티켓, 범위, 위험도, 검증, 의존관계와 입력/출처 근거 | 재검토/재승인 필요 |
| 저장소 콘텐츠 | Git 상태 출력, 추적 파일과 ignore되지 않은 미추적 파일의 경로·내용/링크 정보 | 이전 검증/콘텐츠 승인 재사용 차단 |
| 릴리스 승인 | 승인 ID, 요청/실행, Git 작업·메시지·remote/대상 브랜치, 티켓의 worktree·기준점·검수 근거 | 다른 작업에 승인을 전용할 수 없음 |
| Jira 입력 | 프로젝트와 이슈 식별, 제목·본문·우선순위 등 현재 구현이 결속하는 필드 | 실행/관리형 릴리스 전에 변경 여부 확인 |

Jira 댓글이나 단순 `updated` 변화는 요구사항 변경으로 보지 않습니다. 다만 **외부 상태 전송의 동시성 검사**는 별도 계약이므로 Jira 상태/버전 변화로 게시를 보류할 수 있습니다.

릴리스는 적용 전에 승인을 소비하는 상태로 전환합니다. 적용 중 실패하면 성공으로 숨기거나 이전 승인을 재사용하지 않고 실패·부분 결과를 남깁니다. 이미 생긴 Git 효과까지 원자적으로 되돌리는 분산 트랜잭션은 아닙니다.

## 격리 실행과 의존관계

- 티켓별 branch와 worktree를 만들어 원본 프로젝트와 작업 파일을 분리합니다. Branch만 전환하는 것과 달리 동시에 서로 다른 작업 폴더를 가질 수 있습니다.
- Runner lease는 티켓 실행의 소유권과 만료를 기록합니다. 시도 횟수는 모델 호출/변경 전에 저장하여 중단된 호출을 없던 일로 처리하지 않습니다.
- 관리형 티켓 기본 한도는 **총 3회 시도(최초 1회 + 재시도 최대 2회)**이며 계획에서 조정합니다. 같은 오류 반복, 권한/인증 문제, 고위험 변경은 한도 전에도 중단할 수 있습니다. 검증 auto-fix의 한도는 별도 설정입니다.
- 선행 작업은 변하는 브랜치 이름 대신 기록된 commit SHA로 연결합니다. 실행 이후 생긴 선행 브랜치의 새 커밋을 조용히 끌어오지 않습니다.
- 같은 프로젝트의 서로 다른 선행 브랜치를 합쳐야 하는 fan-in은 자동 merge하지 않습니다. 통합 티켓과 승인, 통합 결과 검증이 필요합니다.
- Worktree는 파일 작업 공간의 격리입니다. 공유 DB·포트·외부 서비스·자격증명까지 격리하지 않으므로 테스트 자원은 프로젝트별로 분리해야 합니다.

선택형 멀티에이전트는 기본 OFF입니다. 역할별 분석, 단일 writer가 기본이며, multi-writer는 명시적 opt-in·겹치지 않는 `owned_paths`·동일 기준 SHA·격리 worktree를 요구합니다. 실제 병렬 실행은 호스트 capability에 달려 있습니다.

## 컨텍스트와 모델 비용

필수 안전 계약과 실제 프로젝트 계획·선택 티켓은 유지하되, 모드/스택 상세 문서를 매번 모두 읽지 않습니다. L5·자동수정·멀티에이전트 상세 절차는 해당 실행 모드에서 추가합니다. 프로젝트가 작성한 규칙이나 명시된 필수 자료를 단순히 크다는 이유로 생략하지 않으며, 필수 자료 누락/예산 초과는 실패로 처리합니다.

프로젝트 문서와 Confluence 자료는 `untrusted-project-input`입니다. 정보로는 사용하지만 "승인을 생략하라" 같은 문서 속 지시가 중앙 정책이나 도구 권한을 바꾸지 못하도록 구분합니다.

```bash
npm run harness -- context --json
npm run harness -- provider status
npm run harness -- provider use openai
npm run harness -- provider usage --json
```

OpenAI·Anthropic·Gemini API 어댑터를 제공하며 작업 유형·위험도·중요도·재시도에 따라 `fast / standard / strong` 티어를 선택합니다. 고위험 티켓에 `fast`를 강제하면 거부합니다. 사용할 모델의 계정별 가용성을 확인하고 실제 모델명을 로컬 설정에 지정합니다.

대화형 호스트의 구독 토큰과 하네스가 직접 호출하는 API 과금은 별개입니다. 로컬 사용량은 **하네스가 관측한 응답**만 집계합니다. 계정 전체 잔액·호스트 구독 잔여량은 임의 추정하지 않으며 지원 API/권한이 없으면 `unknown`입니다. `--cost`의 선택형 USD 추정도 설정된 단가와 관측량 기준 참고치이지 청구액이 아닙니다.

반복 비용을 줄이기 위해 바이트 기반 컨텍스트 추정, Quick 캐시, 조회 시 불필요한 전체 이력 재구성 생략을 사용합니다.

## Jira·Confluence·알림

| 연결 | 역할과 승인 경계 |
| --- | --- |
| Jira | 상세 티켓·라벨·우선순위·상태 조회/반영. 카드 이동만으로 코드 실행이 승인되지는 않음 |
| Confluence | 프로젝트 맥락과 결과 문서 보관. 선택 페이지/버전·내용을 로컬 근거와 연결 |
| Telegram / Slack | 프로젝트가 구분된 계획·실패·검수 대기 알림. 알림 전송과 실제 실행은 별도 |
| MCP / REST | Atlassian은 MCP 우선, REST는 명시적 호환 선택. 호스트 플러그인 연결과 Node CLI의 인증/도구 매핑은 별개 |

외부 쓰기는 게시 payload 승인 또는 프로젝트별 유효한 범위 동의가 있어야 합니다. 범위 동의는 반복 기록을 편하게 만들지만 개발 실행이나 Git 승인 권한까지 주지는 않습니다.

게시 outbox는 확실한 거절(`REJECTED`)과 결과 불명(`SENDING`, `NEEDS_RECONCILIATION`)을 구분합니다. 원격에서 처리했는데 응답만 잃었을 수 있으므로, 결과 불명 요청은 중복 생성하거나 다음 상태로 덮어쓰지 않고 확인을 기다립니다. 알림의 실패 채널 재시도도 구현/빌드를 다시 실행하지 않습니다. 외부 시스템까지 포함한 exactly-once 전달을 보장하는 것은 아닙니다.

Jira/Confluence의 비공개 여부는 **Atlassian 계정·프로젝트·스페이스 권한 설정**에 달려 있습니다. 하네스에 연결했다고 자동으로 비공개가 되지 않습니다. 회사 문서의 모델 API/개인 공간 전송은 조직 정책을 먼저 확인해야 합니다.

## 기록 검색과 다른 PC

```bash
npm run harness -- dashboard
npm run harness -- history list --project sample --status REVIEW_READY
npm run harness -- history search --project sample --query "재시도"
npm run harness -- history search --technology Redis --from 2026-01-01
npm run harness -- atlassian search --project sample --query "테스트"
```

로컬 기록 검색과 실제 Jira 검색은 다른 조회입니다. 선택형 `dashboard --check-connections`는 연결 진단, `--notify`는 외부 알림이므로 기본 로컬 조회와 구분합니다.

| 저장 위치 | 내용 |
| --- | --- |
| `.harness/tasks/` | 하네스 자체/단일 저장소의 backlog·active·review·blocked·archive Markdown 티켓 |
| `.harness/local/` | 프로젝트 등록·프로필, 요청/실행, 승인, 검수/작업 이력, 원격 컨텍스트·outbox·평가 결과 |
| `.worktrees/` | 관리형 티켓 작업 공간 |
| `observability/` | 검증·실행·사용량 로그와 메트릭 |
| `memory/`, `docs/` | 정책, 설계 결정, 프로젝트 문서와 선택적으로 주입하는 지식 |

로컬 상태와 비밀값은 일반적으로 Git에서 제외합니다. **저장소 clone이나 Jira/Confluence 연결만으로 로컬 실행 이력이 복원되지는 않습니다.** 다른 PC에서는 저장소/프로젝트를 준비하고 승인형 암호화 백업 복원, 경로 재등록과 기준점·컨텍스트 검증을 수행합니다. 복원된 과거 승인으로 새 환경의 작업을 곧바로 실행하지 않습니다.

관리형 작업은 감사 이력을 남기지만 하네스 밖의 모든 편집을 자동 수집하지는 않습니다. 배포 이력은 별도 기록이며 Git push를 운영 배포로 간주하지 않습니다. 경력 근거 초안은 실제 commit/PR 근거를 검토한 뒤 확정하고, 외부 출력은 공개 허용된 `VERIFIED` 항목으로 제한합니다.

## 실패와 복구

실패를 발견하면 **Why + Safe Next Action**으로 원인 범주와 첫 확인 명령을 안내합니다. 불확실한 상태에서 무조건 재시도하거나 파일을 정리하지 않습니다.

| 상황 | 첫 확인 | 확인 후의 판단 |
| --- | --- | --- |
| 실행 중단, 살아 있거나 만료된 lease | `runner status REQUEST_ID` | 실행 주체·worktree·시도 기록 확인 후 필요할 때만 reconcile/승인형 복구 |
| 외부 게시 응답 유실 | `atlassian status` | 원격 marker·목적지·상태 확인 후 일치할 때 reconcile. 미발견만으로 재POST 금지 |
| 확실한 외부 거절 | `atlassian status`, `atlassian recovery ENTRY_ID` | 인증/요청 수정 후 명시적 retry-rejected, 새 게시 근거 확인 |
| 검수 이후 콘텐츠/Jira 핵심 입력 변경 | `release status APPROVAL_ID` | 현재 입력/계획·검증·검수를 갱신하고 새 승인 요청 |
| 후속 기록 누락 의심 | `atlassian status` | 필요하면 `operations audit`로 로컬 후속 상태 재구성 |

`operations audit`는 로컬 파생 기록을 갱신할 수 있어 순수 조회가 아닙니다. `cleanup`도 dry-run의 안전 대상과 승인 지문을 확인한 후 처리하며 사용자 파일을 무차별 삭제하지 않습니다. `git reset --hard`나 `git clean -fd`로 자동 복구하지 않습니다.

## 테스트와 AI 품질 평가

### 실행 안전성

```bash
npm test
npm run coverage
npm run lint
npm run harness -- verify --full --task YOUR_ACTIVE_TICKET
```

이 저장소는 Node 테스트·ESLint·커버리지 임계값과 메모리 형식 검사를 사용합니다. `build`는 현재 lint 별칭이며 별도 제품 번들을 만드는 빌드가 아닙니다. 외부 프로젝트에서는 **그 프로젝트의 실제 테스트/빌드**를 승인된 검증 명령으로 등록해야 합니다.

단일 저장소 `complete-task`의 정상 경로는 현재 콘텐츠에 결속된 Full 검증만 인정합니다. Quick은 개발 중 피드백용이며 완료 근거가 아닙니다. 관리형 runner는 티켓의 승인된 프로젝트 검증 명령을 실행하고 결과 지문을 남깁니다. 이 두 경로를 혼동하여 중앙 하네스 테스트 통과로 외부 제품 검증을 대신하지 않습니다.

복합 회귀는 실제 상태 저장과 관리 명령들을 연결하고, 모델·HTTP·Git 효과는 격리된 어댑터로 통제합니다.

- Promise barrier로 runner A를 대기시킨 사이 B가 진입해도 활성 lease·시도 횟수·시도 이력이 보존되는지 확인합니다.
- Jira 상태 전송 응답 유실 후 코드 실행이 끝나고 flush가 반복되어도 불확실한 전송을 재실행하거나 새 상태로 덮어쓰지 않는지 확인합니다.
- 구현 검증·사람 수락·릴리스 승인 이후 파일/제목/본문/우선순위를 바꾸면 Git 효과가 차단되고, 무관한 댓글 변경은 허용되는지 확인합니다.

실행 순서는 `sleep` 대신 Promise barrier로 통제하며, 별도 Git 통합 테스트와 Windows·macOS·Linux CI를 함께 사용합니다.

### 계획의 의미 품질

```bash
npm run harness -- eval planning list
npm run harness -- eval planning import --responses-file .harness/local/responses.json
npm run harness -- eval planning show EVAL_ID
```

9개 고정 합성 사례에서 구조/출처/명령/경계 검사는 자동 채점하고, 다음은 **사람이 사례별 rubric으로 평가**합니다.

- 테스트 계획에 대상·조건·기대 결과가 있는가?
- 요구사항 누락이나 요청하지 않은 리팩터링/스키마 변경이 있는가?
- 필수 정보가 없을 때 질문했는가, 임의의 가정으로 결정했는가?

구조 PASS와 의미적 정확성은 별도로 평가합니다. 추상적인 문구 자체를 정규식으로 금지하는 대신 사람 검수에서 `changes-requested`와 수정 근거를 남깁니다. 모델/프롬프트 비교는 동일 입력·정책·루브릭·출처 조건에서 수행하고, 실제 API 호출은 비용·자료 전송 승인과 명시적 한도가 필요합니다.

## 구현 위치와 설계 선택

| 책임 | 핵심 구현 | 설계 이유/절충 |
| --- | --- | --- |
| CLI·설정 | [index.js](tools/harness-cli/index.js), [config.js](tools/harness-cli/config.js) | 공통 Node 구현, 셸 래퍼는 호환용. 핵심 파일 크기는 계속 관리 필요 |
| 계획·입력 근거 | [planning-contract.js](tools/harness-cli/planning-contract.js), [planning-command.js](tools/harness-cli/planning-command.js), [request-plan.js](tools/harness-cli/request-plan.js) | 구조 검증과 의미 검수 분리 |
| 컨텍스트 | [agent-context.js](tools/harness-cli/agent-context.js), [project-context.js](tools/harness-cli/project-context.js) | 필요한 자료만 선택하되 필수 안전 계약은 유지 |
| 실행·의존성 | [agent-runner.js](tools/harness-cli/agent-runner.js), [project-execution.js](tools/harness-cli/project-execution.js) | lease·시도 기록·SHA 기반 계보. 무조건적 병렬화/자동 통합 배제 |
| 승인·Git | [control-plane-command.js](tools/harness-cli/control-plane-command.js), [governance-ledger.js](tools/harness-cli/governance-ledger.js) | 사람 검수와 단발 Git 승인 분리 |
| 영속성 | [control-plane-state.js](tools/harness-cli/control-plane-state.js) | 원자적 저장과 파일 잠금. 외부 API까지 단일 트랜잭션으로 묶지는 못함 |
| 게시·알림 | [operations-publish.js](tools/harness-cli/operations-publish.js), [runner-notifications.js](tools/harness-cli/runner-notifications.js) | 개발 결과와 외부 전달 실패 분리 |
| 이력·복구 안내 | [work-history.js](tools/harness-cli/work-history.js), [safe-next-action.js](tools/harness-cli/safe-next-action.js) | 조회 감사는 남기고 불필요한 전체 재구성 생략. 복구보다 확인 우선 |
| 모델·평가 | [model-router.js](tools/harness-cli/model-router.js), [planning-eval.js](tools/harness-cli/planning-eval.js) | 비용·위험도에 따른 티어 선택과 실제 품질 평가를 구분 |

## 지원 범위와 한계

**기본 사용:** 개인 개발자의 다중 프로젝트 등록, 상세 계획/검수 기록, 승인형 실행·Git 반영, 이력 조회. **선택 연동:** 모델 API, Atlassian, 알림, 백업/근거 출력. **실험 기능:** L4.5 자동 수정, L5 제한 자율 루프, 멀티에이전트. 기본 사용을 위해 실험 기능을 켤 필요는 없습니다.

하네스는 AI 모델이나 범용 챗봇이 아니라 **사람의 최종 승인을 전제로 한 관리형 실행 도구**입니다. 보장 범위는 다음과 같습니다.

- **통제 경계:** OS 보안 샌드박스가 아니므로 하네스 밖의 파일 수정이나 raw `git commit/push`를 물리적으로 막지 않습니다. Fingerprint는 변경 탐지값이지 전자서명이나 사용자 인증이 아닙니다. 문서를 비신뢰 입력으로 구분하는 것도 모든 프롬프트 인젝션을 제거하는 장치는 아닙니다.
- **결과 품질:** 계획의 타당성과 코드의 정확성은 수용 기준·테스트·사람 검수의 품질에 의존합니다. 모델 티어를 높이거나 역할을 분리하는 것만으로 정확성이 보장되지는 않습니다.
- **측정 근거:** 모의 응답 통과는 실모델 성능 측정이 아니며, 격리된 장애 테스트가 모든 실계정 장애를 재현하지는 않습니다. 업무 시간·토큰·비용 절감 효과는 실제 사용에서 별도로 측정해야 합니다.

다음은 별도로 확인해야 합니다.

- 사용자 계정별 모델 가용성, API 과금·권한, MCP 도구 매핑과 Jira 워크플로
- 회사의 비밀정보·문서 반출 정책, 공유 테스트 자원과 운영 환경의 권한
- 장기 실계정 운영, 장애/비용/품질의 반복 측정과 새로운 PC의 복원 검증

로컬 테스트 통과, 모의 연동, 제한된 실계정 리허설, 최신 PR CI 통과는 서로 다른 근거입니다. 실제로 수행하지 않은 단계를 완료했다고 표시하지 않습니다. 기존 티켓도 코드가 merge되었다는 이유만으로 운영 검수 조건을 생략해 자동 마감하지 않습니다.

## 상세 문서

README는 시스템의 목적·구조·사용 흐름·안전 경계·한계를 설명하는 문서입니다. 전체 JSON 스키마와 드문 복구 옵션은 아래 문서를 원본으로 사용하여 중복 유지보수를 줄입니다.

- [전체 CLI 가이드](docs/HARNESS_GUIDE.md), [개인 운영 가이드](docs/HARNESS_PERSONAL_OPERATIONS_GUIDE.md)
- [계획 품질 계약](docs/PLANNING_QUALITY_GUIDE.md), [기획·설계 티켓](docs/PLANNING_TICKETS.md)
- [Atlassian 설정](docs/ATLASSIAN_MCP.md), [운영 상태와 비용](docs/OPERATIONS_STATUS.md)
- [티켓 컨텍스트 참조](docs/TICKET_CONTEXT_REFERENCES.md), [백업과 복원](docs/STATE_BACKUP.md)
- [운영 근거 보고서](docs/OPERATIONS_EVIDENCE_GUIDE.md), [운영 검증 기록](docs/project/PERSONAL_OPERATIONS_VALIDATION.md)
- [필수 안전 계약](docs/design-docs/safety-contract.md), [릴리스 정책](docs/RELEASE_SAFETY.md), [에이전트 진입 규칙](AGENTS.md)

전체 명령은 `npm run harness -- help --all`에서 확인할 수 있습니다.
