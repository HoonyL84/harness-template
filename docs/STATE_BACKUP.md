# 기록 백업과 컨텍스트 예산

## 1. 보존 범위와 한계

`backup`은 로컬 증거 보존 도구다. 실행 중인 작업을 다른 PC에서 그대로 이어가는 마이그레이션 도구가 아니다.

보존 대상:
- `.harness/local/`: 프로젝트 프로필, 컨텍스트 스냅샷, 요청·실행·승인·이력 등 로컬 기록.
- `.harness/tasks/`: 하네스 자체의 티켓 문서.
- `observability/metrics/`, `observability/provider-usage/`: 지표와 관측한 사용량.
- 등록 프로젝트의 티켓과 관리형 실행에서 재구성한 검색용 작업 이력.

제외 대상:
- `.env*`, 키/토큰/비밀번호/credentials 이름의 파일, 알려진 비밀 필드가 있는 JSON.
- 프로젝트 소스, 프로젝트 자체 문서 원본, worktree, Git 저장소, 모델 응답 trace.
- 이전 복원 폴더, 복원 미리보기, 임시 파일 및 기존 백업 파일.

파일명·JSON 필드 검사는 완전한 비밀 탐지기가 아니다. 문서나 패치에 실수로 기록된 비밀까지 탐지한다고 보장하지 않는다. 백업에는 업무 자료와 절대 경로가 들어갈 수 있다. 암호화된 백업도 승인된 개인 저장소에만 보관한다. 회사 자료를 개인 서비스로 반출할 권한을 부여하는 기능이 아니다.

## 2. 백업 생성

모델 실행, 검증, 게시와 다른 상태 변경 명령을 먼저 중단한다. lock 또는 RUNNING/VERIFYING 실행이 남아 있으면 생성이 거부된다. 중단된 작업은 기존 reconcile/복구 절차로 확인한 뒤 진행한다. 파일 목록과 내용이 생성 도중 달라져도 거부한다. 모든 작성자가 공유하는 DB 트랜잭션은 아니므로 실행 중 백업의 일관성을 보장하지 않는다.

`.env.local`에 `HARNESS_BACKUP_PASSPHRASE`를 16자 이상으로 설정한다. 강하고 고유한 암호를 비밀번호 관리자에도 보관한다. 암호를 대화, 티켓, CLI 인자 또는 Git에 넣지 않는다.

```bash
node tools/harness-cli/index.js backup create
node tools/harness-cli/index.js backup create --output /absolute/private/location/state.harbackup.json
node tools/harness-cli/index.js backup inspect --file /absolute/private/location/state.harbackup.json
```

기본 경로는 Git 제외 대상인 `.harness/backups/<id>.harbackup.json`이다. 로컬 파일만 생성하며 자동 업로드나 주기적 백업은 하지 않는다. 기존 파일은 덮어쓰지 않는다. 출력한 `skipped`를 검토한다. 기본 백업 폴더 자체도 다른 디스크의 승인된 저장소로 보존해야 로컬 디스크 손실에 대비할 수 있다.

암호화는 Node 내장 scrypt와 AES-256-GCM을 사용한다. 틀린 암호와 손상된 암호문은 인증 실패로 거부한다. 파일당 4MiB, 최대 1,000개, 전체 JSON 평문 16MiB 제한이 있다. 제한 초과는 조용히 생략하지 않고 실패한다. 암호를 잃으면 백업을 해독할 수 없다.

## 3. 승인형 증거 복원

같은 암호를 대상 하네스의 로컬 환경에 설정한 뒤 실행한다.

```bash
node tools/harness-cli/index.js backup restore --file /absolute/private/location/state.harbackup.json
# 출력된 preview_id, 파일 수, 격리 경로를 검토한 뒤
node tools/harness-cli/index.js backup restore --file /absolute/private/location/state.harbackup.json --approve PREVIEW_ID
node tools/harness-cli/index.js history search --query "검색어"
```

첫 명령은 10분짜리 미리보기만 생성한다. 승인은 암호문의 지문, 대상 하네스, 백업 ID에 결속되며 한 번만 사용된다. 변경·만료·재사용은 거부된다. symlink/junction과 경로 이탈, Windows 경로 별칭 및 파일 해시 불일치도 거부된다.

승인 후 결과:
- 원래 파일은 `.harness/local/restored/<backup-id>/` 아래에 **격리 자료**로만 저장한다.
- 검색용 이벤트는 `RESTORED_*` 유형으로 현재 이력에 추가한다. 이전 USER_REVIEW 수락 기록도 현재 Git 승인이 될 수 없다.
- 프로젝트 등록, 실행 상태, lease, Git 승인, 전송 outbox와 사용량 설정을 현재 운영 상태로 활성화하지 않는다. 기존 로컬 상태를 덮어쓰거나 삭제하지 않는다.

격리 폴더는 OS 보안 샌드박스가 아니다. 자료는 평문으로 복원되므로 로컬 디스크와 접근 권한을 보호한다. 다른 PC에서는 소스 clone, 비밀키 설정, 프로젝트 재등록/온보딩, 새 계획·Git 승인이 필요하다. 격리 자료를 live 디렉터리에 통째로 덮어쓰지 않는다.

복원 중 디스크/이력 쓰기에 실패하면 승인도 이미 소비되고 일부 자료가 남을 수 있다. 자동 롤백·삭제·재실행은 하지 않는다. 오류와 격리 폴더를 확인해 누락 자료를 수동으로 복구한다. 같은 ID로 다시 복원할 수 없으므로 폴더를 무작정 지우지 않는다.

## 4. 티켓별 컨텍스트

프로젝트 전체 번들의 기본 제한은 40개 문서/256KiB다. 파일 수 또는 바이트 제한으로 빠진 문서를 `omitted`에 사유와 함께 남기고 `truncated: true`로 표시한다. 전체 파일 검색이 아니라 알려진 Markdown 경로의 문서만 대상으로 한다.

```bash
node tools/harness-cli/index.js project context PROJECT_ID --bundle --query "payment idempotency"
node tools/harness-cli/index.js project context PROJECT_ID --bundle --max-files 80 --max-bytes 524288
node tools/harness-cli/index.js runner run REQUEST_ID --full-context
```

관리형 runner는 기본적으로 승인 티켓의 목표·범위·소유 경로·수용 기준을 이용해 문서 경로를 우선순위화한다. 기본 12개/64KiB이며 AGENTS, PLANS, OVERVIEW, README와 핵심 설계 지침은 우선 포함한다. 기본 지침 수가 12개보다 많으면 파일 수 제한보다 지침 보존이 우선한다. 기본 지침이 바이트 예산 안에 들어가지 않으면 진행하지 않는다. 전체 번들은 기존 프로젝트 단위 우선순위로 돌아간다.

최근 작업 이력과 허용된 Confluence 스냅샷은 티켓 번들의 예산 중 최대 1/4 범위에서 먼저 담는다. 나머지 문서의 누락은 메타데이터에 전부 표시하고 AI 프롬프트에도 누락 수와 최대 10개 예시를 전달한다. 더 필요한 정보는 확인한 뒤 `--full-context`나 수동 번들로 보충한다.

이 선별은 **파일명 기반 힌트**다. 의미 검색, 요구사항 완전성 검사 또는 정확성 보장이 아니다. 표시하는 `utf8-bytes/3` 토큰 추정은 컨텍스트 크기의 참고값이며 공급자의 실제 과금이나 전체 프롬프트 사용량과 다를 수 있다. Confluence 문서를 포함한 프로젝트 입력은 계속 untrusted이며 중앙 정책과 승인을 변경할 수 없다.
