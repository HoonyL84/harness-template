# 컨텍스트·재수정·실행 검증 가이드

이 기능은 불필요한 입력과 같은 실패의 반복을 줄이기 위한 보완입니다. 기존 중앙 실행기의 티켓별 문서 선별, 시도 예산, 동일 오류 중단, 승인 경계를 대체하지 않습니다. 외부 SDK나 추가 진단용 AI 호출은 도입하지 않습니다.

## 1. 호출 전 컨텍스트 확인

```bash
node tools/harness-cli/index.js context --task my-ticket --json
node tools/harness-cli/index.js context --task my-ticket --full-context
```

`my-ticket`은 active 티켓 이름입니다. 티켓 없이 기본 문서만 확인하려면 `--task`를 생략합니다. 기본 focused 모드는 구현에 불필요한 전체 역할 개요를 생략합니다. architect/review 타입 또는 `--full-context`는 역할 개요를 포함합니다. 실제 역할별 프롬프트는 기존처럼 별도로 적용됩니다.

AGENTS, 핵심 신념, 실행 모드, L4.5/L5 정책, 계획, 기술 스택, 지정한 active 티켓은 전체 내용을 유지합니다. 티켓에서 추가로 필요한 문서만 명시하세요.

```markdown
## Context Files
- `docs/design-docs/my-feature.md`
- `memory/semantic/my-domain.md`
```

목록은 `docs/` 또는 `memory/` 아래 Markdown 상대 경로만 허용합니다. 경로 이탈, 숨김 경로, symlink/junction은 거부합니다. 필수 파일 누락이나 기본 96KB 예산 초과는 오류이며 조용히 잘라내지 않습니다. 필요하면 목록을 좁히거나 preview의 `--max-bytes`를 조정하세요(1KB~1MB). `run-agent`는 기본 96KB 예산을 사용합니다.

`--full-context`는 기본 문서를 더 포함하는 옵션이지 전체 저장소·과거 기록을 모두 읽는 옵션이 아닙니다. 의미 기반 검색도 아닙니다. JSON의 bytes와 `estimated_input_tokens`는 비교용 추정치이며 공급자 청구 사용량이 아닙니다. 프로젝트 문서는 정책이나 승인을 우회할 권한이 없습니다.

## 2. 검증 실패 후 재수정

API 실행기가 적용한 패치의 검증이 실패하면 다음 응답은 아래 두 블록을 같은 호출에서 반환해야 합니다. 로컬 `verify --auto-fix`도 이 형식을 요구합니다.

````text
```repair
{"hypothesis":"경계값 비교가 잘못됨","evidence":"경계값 테스트에서 기대값과 실제값 불일치","minimal_test":"해당 경계값 테스트 하나로 가설 확인"}
```
```diff
diff --git a/src/example.js b/src/example.js
...
```
````

가설·관측 근거·최소 확인 방법이 없거나 이미 검증에 실패한 동일 패치를 다시 보내면 적용 전에 중단합니다. 중앙 실행기는 패치 해시와 근거를 시도 이력에 기록하여 재개 시에도 중복 실패를 확인합니다. 로컬 auto-fix는 근거를 `observability/traces/`에 기록하고 같은 verify 호출 안에서 실패 패치를 추적합니다.

이 항목은 AI의 **주장**을 기록하는 것이며 가설의 진실성이나 테스트의 의미적 완전성을 증명하지 않습니다. `minimal_test` 문자열을 임의 명령으로 실행하지 않습니다. 실제 통과 여부는 승인된 검증 명령으로 확인합니다. 최초 구현의 diff-only 응답과 일시적 API 오류의 기존 재시도는 유지합니다. 비용·시도 한도와 사용자 승인도 그대로 유지합니다. 안전하게 원복하지 못하면 재수정을 이어가지 않습니다.

대화형 작업에서도 실패 로그 확인 → 원인 가설 → 가설을 구분하는 최소 테스트 → 수정 → Full 검증 순서로 진행하세요. 관측 없이 같은 명령·패치를 반복하지 마세요.

## 3. Full에 실제 사용 흐름 검증 연결

프로젝트의 `.harness/config.json`에 독립적인 smoke 명령을 넣을 수 있습니다.

```json
{
  "config_version": "1.0",
  "verify": {
    "smoke": ["node test/smoke.js"]
  }
}
```

명시적 명령이 없으면 package scripts의 `test:smoke`, 그다음 `smoke`를 자동 감지합니다. Full의 기존 테스트·린트·빌드 성공 후 중복 명령을 제거해 순차 실행합니다. 실행 실패는 Full 실패이며 마감용 성공 지문을 만들지 않습니다. Quick에서는 실행하지 않습니다. smoke만으로 실질적인 제품 테스트·빌드를 대신할 수 없습니다.

아무 smoke도 설정하지 않았다면 실제 실행을 확인하지 않았다는 경고를 남깁니다. 기존 테스트·빌드 성공과 실제 사용 흐름 성공은 다른 근거입니다. 예를 들어 서버 프로젝트에서는 격리된 임시 포트로 서버 시작 → 요청/응답 확인 → 종료를 검사할 수 있습니다. UI나 게임은 별도의 프로젝트별 시나리오가 필요합니다.

명령은 유한 시간 안에 종료하고 `finally`에서 서버·임시 자원을 닫도록 작성하세요. 테스트용 데이터와 격리 환경을 사용하며 운영 DB·외부 계정에 쓰는 명령은 별도 승인 없이 추가하지 마세요. 하네스가 제품 서버를 임의로 기동하거나 사용자의 환경을 자동 구성하지는 않습니다.

## 검증 범위

회귀 테스트는 문서 예산·경로 이탈·junction, repair 형식·동일 패치 차단, 실제 로컬 HTTP 요청, smoke 실패의 Full 차단과 Quick 분리를 검사합니다. 이 테스트는 유료 모델 API 호출이나 제품별 동작 정확성을 보증하지 않습니다. 로컬 Windows 통과와 GitHub Windows/macOS/Linux 통과를 구분하고, 원격 필수 CI가 완료되기 전에는 3개 OS 검증 완료라고 표현하지 않습니다.

참고: [Claude Code 실무 가이드](https://code.claude.com/docs/en/best-practices), [Systematic Debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md). 외부 스킬을 설치하거나 절차 전체를 강제한 것은 아닙니다.
