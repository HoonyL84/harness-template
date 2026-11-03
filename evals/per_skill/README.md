# Per-Skill Evaluation (`skill-eval.js`)

## 목적과 한계
`skills/<skill-name>/` 아래에 정의된 스킬의 호출 판단과 출력 계약을 작은 fixture(`examples.jsonl`)로 반복 평가한다. 유료 API 호출·자동 코드 수정은 없다.
검사 대상은 **별도로 작성된 AI 응답**이다. 응답을 기대값으로 자동 생성해 통과시키지 않는다.
oracle은 알려진 결함의 위치/심각도와 출력 계약을 검사한다. 설명의 의미적 정확성, 미지의 결함, 실제 모델 품질은 인간 검수 대상이다.

## 실행
1. 등록된 평가 가능 스킬 목록 확인:
   - `node tools/harness-cli/skill-eval.js --list-skills`
2. 평가 문제(`input`, `diff`) 추출 (`expected` 정답은 숨김, 기본 스킬은 `code-review`):
   - `node tools/harness-cli/skill-eval.js --cases`
   - 특정 스킬 지정: `node tools/harness-cli/skill-eval.js --skill <skill-name> --cases`
3. 평가할 AI에 `skills/<skill-name>/SKILL.md`와 해당 입력을 제공하고 아래 형식으로 응답을 수집한다. 테스트 실행 여부는 실제 근거대로 기록한다.
4. 응답 JSON 배열을 로컬 파일로 저장하고 채점 실행:
   - `node tools/harness-cli/skill-eval.js [--skill <skill-name>] --responses <file.json>`
5. PASS라도 findings 설명을 사람이 검수한다. 동일 모델 자기 평가와 독립 평가를 구분하고 모델/날짜/환경은 실행 기록에 함께 남긴다.

```json
[{
  "id": "auth-bypass",
  "selected_skill": "code-review",
  "status": "reviewed",
  "findings": [{
    "severity": "P1",
    "file": "src/handler.js",
    "line": 2,
    "explanation": "구체적인 발생 조건과 영향",
    "suggestion": "최소 수정 방향"
  }],
  "residual_risks": ["검증하지 못한 연동 경로"],
  "tests_run": [],
  "limitations": ["정적 diff 검토만 수행"]
}]
```

변경 입력이 없는 리뷰 요청은 `needs-context`, 다른 업무는 `not-applicable`이며 `findings`는 비워둔다.
선택하지 않는 경우 `selected_skill`은 `null`이다. `needs-context`는 리뷰 스킬의 입력 확보 단계이므로 해당 스킬명을 유지한다.
`tests_run`이 비어 있으면 `limitations`에 실행하지 않은 사실을 기록한다.
응답이 누락되거나 알려진 결함을 놓치면 종료 코드 `1`이다.

## 회귀 계약
`node --test tests/harness-cli/skill-eval.test.js tests/harness-cli/lean-workflow.test.js`
이 테스트는 oracle과 다중 스킬 로딩/심볼릭 링크 차단 동작을 검증한다. 실제 AI의 리뷰 정확도 측정이 아니다.
