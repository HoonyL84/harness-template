# 운영 현황과 안전한 복구

## 하루 작업 시작

Windows 실행 정책을 변경하지 않아도 된다. PowerShell은 npm.cmd, 모든 OS는 Node 직접 실행을 지원한다.

```powershell
npm.cmd run harness -- dashboard
node tools/harness-cli/index.js dashboard --json
node tools/harness-cli/index.js dashboard --check-connections
node tools/harness-cli/index.js dashboard --notify
```

기본 dashboard는 로컬 조회와 Git status만 실행한다. 프로젝트 dirty/clean/unknown, 로컬 티켓, 이번 달 관측 토큰/설정 예산, 연결 설정을 출력한다. API 키와 원본 파일 내용은 출력하지 않는다. 연결 설정은 건강 상태가 아니다.
--check-connections만 외부 읽기 진단을 한다. Atlassian은 인증 읽기, Telegram은 getMe만 확인하며 채팅 수신/쓰기 권한까지 증명하지 않는다. Slack webhook은 메시지 전송 없이 검증할 수 없어 not-supported-read-only다. --notify만 실제 현황을 전송한다. 오프라인에서는 외부 진단/전송을 하지 않는다.

## 구현과 운영 검수 분리

과거 8개 구현 티켓은 .harness/tasks/review/에서 원문과 미충족 조건을 보존한다. 완료/사용자 수락/새로운 실계정 성공을 꾸며내지 않는다. history audit-tasks와 history search --status REVIEW로 확인한다. 필요한 검수/보완을 수행할 때 start-ticket NAME --from-review로 active에 재개하고 fresh Full 검증과 정상 complete-task 절차를 따른다. 폴더 이동만으로 완료되지 않는다.

## 게시 실패 복구

```bash
node tools/harness-cli/index.js atlassian recovery
node tools/harness-cli/index.js atlassian recovery ENTRY_ID
```

이 명령은 로컬 outbox에서 상태별 다음 명령만 안내한다. 재전송/삭제/승인을 실행하지 않는다.
- PENDING: preview 후 현재 payload digest에 명시 승인 또는 기존 유효한 scoped consent로 sync.
- REJECTED: 인증/권한/요청 문제를 해결한 뒤 retry-rejected ENTRY_ID --approve ENTRY_ID, 새 preview와 별도 게시 승인. 재큐 승인은 게시 승인이 아니다.
- SENDING / NEEDS_RECONCILIATION: 실제 원격 marker/대상을 먼저 확인하고 reconcile ENTRY_ID --remote-id VERIFIED_ID. 확인 전에 재POST하지 않는다.
- SUPERSEDED: 바뀐 코드/근거를 재검증·검수한 후 새 초안을 준비한다. 오래된 승인을 재사용하지 않는다.
- SYNCED: 재시도하지 않는다. operations flush는 기존 유효한 동의 범위의 안전한 대기 건만 처리한다.

## 선택형 관측 비용

provider usage --cost --json 또는 dashboard --cost로만 표시한다. .harness/local/pricing.json은 Git 제외 로컬 설정이다. 아래 값은 테스트용 예시이지 실제 모델 단가가 아니다. 사용 모델의 공식 단가를 직접 확인하고 적용 월/기준일과 함께 넣는다. 자동 환율/가격 조회나 설정 생성은 하지 않는다.

```json
{
  "schema_version": "1.0",
  "month": "2026-10",
  "models": {
    "openai": {
      "YOUR_MODEL": {
        "source": "https://openai.com/api/pricing/",
        "as_of": "2026-10-03",
        "input_per_million": 1,
        "output_per_million": 2,
        "cached_input_per_million": 0.1
      }
    }
  }
}
```

공식 source URL과 단가 기록은 사용자가 관리하는 참고 자료이며 하네스가 가격의 진위를 인증하는 것은 아니다. 해당 월/정확한 모델이 일치하고 기준일이 미래가 아니며 90일 이내인 단가만 사용한다. 모델 별 USD/source/as_of와 known_subtotal_usd를 제공하며 하나라도 미측정이면 전체 usd는 null/unknown이다.
입력·출력·캐시 입력을 구분하며 OpenAI/Gemini의 캐시 입력을 일반 입력에 이중 계산하지 않는다. Gemini 사고 토큰은 응답 메타데이터가 있으면 출력에 포함한다. 기존 합계 전용 기록, 단가 누락, 불완전 사용량, 적용 월 불일치, OpenAI/Anthropic 캐시 생성(쓰기 요금 미지원)은 unknown이다. 캐시 저장료·배치/장문 요금·할인·세금·하네스 밖의 사용은 제외되며 계정 잔액이나 청구액을 뜻하지 않는다. 잘못된 가격 설정은 숨기지 않고 오류로 표시하며 --cost 없는 작업에는 영향을 주지 않는다.

사용량 필드 기준: [OpenAI 캐시 문서](https://developers.openai.com/api/docs/guides/prompt-caching), [Anthropic 캐시 문서](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Gemini 토큰 문서](https://ai.google.dev/gemini-api/docs/tokens). 지원하지 않는 요금 분류는 임의 계산하지 않는다.
