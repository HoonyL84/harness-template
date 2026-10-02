# 운영 근거와 검수 보고서

목적은 더 많은 자율 실행이 아니라, 사용자에게 **무엇을 확인했고 무엇은 모르는지** 짧게 보여주는 것이다. 기존 계획 승인, Full 검증, 사용자 검수, 일회성 Git 승인은 그대로 유지한다.

## 1. 티켓별 보고서

```bash
node tools/harness-cli/index.js history report --project PROJECT --request REQUEST --ticket TICKET
```

등록 프로젝트의 중앙 요청/실행 티켓에 사용한다. legacy Markdown 티켓에는 중앙 실행 지표를 만들어내지 않는다. 출력은 상태, 계획 결속 여부, 현재 코드 지문 일치, 시도/실패 횟수, 실행 및 검증 시간, 관측 API 토큰, 입력/출력 추정치, 수용 기준, 실제 검증 결과, 사용자 검수 기록이다.

- 관측 API 토큰은 **새로 기록된 중앙 runner의 응답**에만 연결된다. 과거 월 전체 사용량을 개별 티켓에 나누어 배분하지 않는다.
- 미기록·누락된 usage는 `null`이다. 대화형 Codex/Claude 채팅 사용량, 응답을 받지 못한 호출의 사용량, 계정 잔액·구독 한도는 포함하지 않는다.
- `estimated_*`는 프롬프트 추정값이며 실제 과금 사용량과 구분한다. 오래된 실행에서 시간 지표가 없으면 `null`이다.
- runner 시간은 마지막 실행 세션의 벽시계 시간이며 사용자의 작업 시간이 아니다. 중단 전후의 모든 시간을 자동 합산하지 않는다.
- 지문이 달라지면 수용 기준 매핑과 현재 검수 표시를 stale 처리한다. 관리형 커밋으로만 갱신된 지문은 기존 reviewed-content 계보와 연결한다.
- 보고서에는 내부 테스트 출력이 포함될 수 있다. 외부 공유 전에 검토하고, 요약만 승인형 결과 게시에 사용한다. 자동으로 Confluence에 올리지 않는다.

## 2. 수용 기준과 테스트 근거 연결

보고서의 acceptance와 verification_results는 1번부터 센다. REVIEW_READY에서 실제 통과한 명령에만 연결할 수 있다.

```bash
node tools/harness-cli/index.js history map-check --project PROJECT --request REQUEST --ticket TICKET --criterion 1 --command-index 1 --note "경계값 assertion이 첫 번째 기준을 확인함"
```

수용 기준별 출력은 `mapped-command-passed; human-review-required` 또는 `unmapped-or-stale`다. 연결이 있다고 해당 테스트가 요구사항을 충분히 검증한다는 뜻은 아니다. 이 작업은 AI도 기록할 수 있는 검수 자료이며 **사용자 수락/승인을 생성하지 않는다**. 마지막에는 사용자가 테스트 내용, 누락 기준, diff를 확인하고 기존 `history review`와 별도 release 승인을 수행한다.

기준·명령이 없거나 실패한 명령, 오래된 계획, 달라진 worktree, REVIEW_READY가 아닌 실행은 매핑을 거부한다. 재검증 이후에는 현재 결과 기준으로 다시 연결한다.

## 3. AX 효과 측정

```bash
node tools/harness-cli/index.js history measure --project PROJECT --request REQUEST --ticket TICKET --baseline-minutes 60 --requirements-minutes 5 --setup-minutes 2 --review-minutes 10 --recovery-minutes 3 --note "동일 범위 작업의 직접 측정값; 예시 숫자는 실제 관측값으로 교체"
```

기준선과 요구 설명·설정·검수·수습 시간은 직접 관측하여 입력한다. 시간을 모르면 해당 옵션을 빼고 `null`로 남긴다. 네 구성요소가 모두 측정되고 기준선이 양수인 경우에만 전체 시간과 절감률을 계산한다. 0분은 실제로 0분인 경우에만 사용한다. 감소하지 않았으면 음수 절감률도 그대로 보여준다.

계산은 `1 - (요구 설명 + 설정 + 검수 + 수습) / 기준선`이다. 기록을 다시 입력하면 이전 값은 보존하고 최신 기록을 사용한다. 같은 난이도·범위의 기준선이 필요하며, 단순 시간 비교가 AI의 인과적 효과를 증명하지는 않는다. 95% 절감은 목표이지 기본 출력이나 검증 통과값이 아니다. 테스트 fixture 숫자를 개인 성과로 사용하지 않는다.

## 4. 티켓 상태 점검

```bash
node tools/harness-cli/index.js history audit-tasks
```

backlog/active/blocked/archive의 체크박스를 확인하는 읽기 전용 점검이다. `[x]`만 있어도 자동 archive하지 않는다. 과거 테스트 성공, 실계정/타 OS 검증, 사용자 검수, 실제 Git 반영은 서로 다른 근거다. 과거 티켓의 현황은 [상태 점검 기록](project/TASK_STATUS_AUDIT.md)을 참고한다.

## 5. 새 PC 준비와 복원 순서

1. 새 PC에서 저장소 clone, Node 24/npm/Git 설치, `check`를 실행한다. Windows 실행 정책 문제에는 `npm.cmd` 또는 직접 Node CLI를 사용한다.
2. 개인 키는 새 PC의 `.env.local`에 다시 설정한다. 키와 백업 암호를 문서·대화·Git에 남기지 않는다.
3. 암호화 백업을 inspect → restore preview → 사용자 승인 순으로 **격리 자료**로 복원한다. 실제 명령과 암호 설정은 [백업 가이드](STATE_BACKUP.md)를 따른다.
4. 대상 프로젝트 소스를 새 PC에 clone하고 새 절대 경로로 `project add` → `project onboard` → 프로필 확인 후 `--approve`한다.
5. Jira/Confluence를 다시 check하고 현재 프로젝트·공간·부모 페이지·MCP 읽기/쓰기 매핑을 확인한다. 자동으로 회사 공간에 개인 문서를 게시하지 않는다.
6. 복원된 작업 이력은 참고 자료로 검색한다. 실행/승인/lease/outbox를 live 폴더에 덮어쓰지 않는다. 새 계획과 검증 및 새 승인을 얻는다.
7. 작은 작업으로 검증·검수·기록을 확인한 후 실무 프로젝트에 적용한다.

`fresh-operations.test.js`는 깨끗한 두 control-root 사이에서 실제 Git worktree·Node assertion·HTTP·로컬 관리형 커밋·암호화 복원·새 경로 재등록을 검사한다. 복원된 USER_REVIEW가 현재 승인이 되지 않는 것도 검사한다. 실제 새 노트북/회사 네트워크에서 가이드만 따라 성공했다는 증거는 아니며, 모델 응답·사용자 결정·알림 전달은 fixture다.

## 6. 실계정 리허설의 안전 범위

HARNESS REHEARSAL 표시의 합성 티켓과 결과 페이지만 승인받아 사용한다. 기존 광고/결제 소스·문서에는 손대지 않고 별도의 임시 Git 저장소에서 실행한다. 불확실한 POST는 재생성하지 않고 isolated outbox의 marker와 원격 ID를 대조한다. 계정·구독·워크플로 변경은 이 리허설에 포함하지 않는다.

MCP가 `listJiraStatuses`를 제공하면 워크플로 조회에는 `jira.projectStatuses`(mode=project), 단일 상태 조회에는 `jira.getStatus`(mode=status) 매핑이 필요하다. 읽기·쓰기 도구의 실제 스키마를 먼저 조회한다. native 응답의 `statuses`와 `workTypes.statusIds`는 확인된 ID·category로 결합하며, 누락·중복 상태는 거부한다. REST로 몰래 전환하거나 상태 ID를 추측하지 않는다.

실제 개인 계정의 Jira/Confluence 성공과 실제 AI 개발 성공은 다르다. 테스트 결과, 모델 응답 fixture, 실제 실행, 사용자 검수, 측정되지 않은 성과를 나누어 보고한다.
