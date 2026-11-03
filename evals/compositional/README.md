# Compositional & Multi-Step Evals

복수 스킬 조합 및 엔드투엔드 컨트롤 플레인 워크플로가 충돌 없이 목표를 달성하는지 검증합니다.

## 실행 경로
1. **컨트롤 플레인 E2E 및 운영 시나리오 검증**:
   - `node --test tests/harness-cli/control-plane-e2e.test.js tests/harness-cli/personal-operations-e2e.test.js tests/harness-cli/orchestration-git-e2e.test.js`
2. **모델/프로바이더 비교 평가 (`eval` 커맨드)**:
   - `node tools/harness-cli/index.js eval list`
   - `node tools/harness-cli/index.js eval run --provider <name> --model <name>`
   - `node tools/harness-cli/index.js eval compare <run-a> <run-b>`
3. **개별 스킬 계약 평가 (`skill-eval.js`)**:
   - `node tools/harness-cli/skill-eval.js --list-skills`
   - `node tools/harness-cli/skill-eval.js --skill <skill-name> --cases`
