# Review Skill Evaluation

## 목적과 한계
스킬의 호출 판단과 리뷰 결과를 작은 fixture로 반복 평가한다. 유료 API 호출·자동 코드 수정은 없다.
검사 대상은 **별도로 작성된 AI 응답**이다. 응답을 기대값으로 자동 생성해 통과시키지 않는다.
oracle은 알려진 결함의 위치/심각도와 출력 계약을 검사한다. 설명의 의미적 정확성, 미지의 결함, 실제 모델 품질은 인간 검수 대상이다.

## 실행
1. `node tools/harness-cli/skill-eval.js --cases`로 input과 diff만 받는다. expected는 출력하지 않는다.
2. 평가할 AI에 `skills/code-review/SKILL.md`와 해당 입력을 제공하고 아래 형식으로 응답을 수집한다. 테스트 실행 여부는 실제 근거대로 기록한다.
3. 응답 JSON 배열을 로컬 파일로 저장하고 `node tools/harness-cli/skill-eval.js --responses <file.json>`을 실행한다.
4. PASS라도 findings 설명을 사람이 검수한다. 동일 모델 자기 평가와 독립 평가를 구분하고 모델/날짜/환경은 실행 기록에 함께 남긴다.

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

변경 입력이 없는 리뷰 요청은 needs-context, 다른 업무는 not-applicable이며 findings는 비워둔다.
선택하지 않는 경우 selected_skill은 null이다. needs-context는 리뷰 스킬의 입력 확보 단계이므로 code-review를 유지한다.
`tests_run`이 비어 있으면 limitations에 실행하지 않은 사실을 기록한다.
응답이 누락되거나 알려진 결함을 놓치면 종료 코드 1이다.

## 회귀 계약
`node --test tests/harness-cli/skill-eval.test.js tests/harness-cli/lean-workflow.test.js`
이 테스트는 oracle과 로딩의 동작을 검증한다. 실제 AI의 리뷰 정확도 측정이 아니다.
