# TICKET: cli-smoke-tests

## Type
chore

## Goal
- Node Harness CLI가 Windows/macOS/Linux에서 같은 핵심 워크플로우 결과를 내는지 검증하는 smoke test를 추가한다.

## Completed
- `check`, `create-ticket`, `start-ticket`, `verify`, `complete-task` 성공 경로를 Bash와 PowerShell smoke test로 검증한다.
- GitHub Actions의 Windows, macOS, Linux 매트릭스에서 공통 CLI와 wrapper 계약을 검증한다.
- PR #14의 크로스플랫폼 CI에서 전체 시나리오가 통과했다.

## Verification
- `.github/workflows/ci.yml`
- `scripts/smoke-test.sh`
- `scripts/smoke-test.ps1`

## Completed At
- 2026-06-14
