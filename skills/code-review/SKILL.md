---
name: code-review
description: Review an existing code diff or pull request for concrete bugs, regressions and missing tests. Not for implementing features, general explanations or claiming review without a diff.
version: 1.1.0
tags:
  - review
  - quality
  - testing
platforms:
  - codex
  - claude-code
  - github-copilot
---

# Code Review

## 호출 경계
- 코드 변경 또는 PR에 대한 검토 요청에 사용한다.
- 변경 내용이 없으면 필요한 diff·요구사항을 요청한다. 보지 않은 코드를 검토했다고 하지 않는다.
- 기능 구현, 일반 개념 설명, 티켓 조회에는 이 스킬을 적용하지 않는다.

## 입력과 실행
1. diff, 기준점, 요구사항과 관련 테스트를 확보한다. 기존 사용자 변경은 보존한다.
2. 변경된 동작에서 실패 경로를 추적한다. 관련 호출부·테스트만 추가로 읽는다.
3. [상세 가이드](../../docs/skills/code-review.md)의 공통 절차를 사용하고, 기술별 체크는 실제 스택에만 적용한다.
4. 발견마다 파일·변경 라인, 발생 조건, 영향, 수정 방향을 기록한다. 추측은 확인 사항으로 분리한다.
5. 승인 없이 코드 수정·커밋·외부 게시를 하지 않는다. 실행한 테스트와 실행하지 못한 테스트를 구분한다.

## 출력과 완료 조건
- 심각도 순 findings를 먼저 제시한다. 각 finding은 근거와 파일·라인을 포함한다.
- 발견이 없으면 "발견 없음"과 남은 위험·검증 공백을 명시한다. 테스트 통과를 correctness 보장으로 바꾸지 않는다.
- 요구사항/관련 변경을 확인하고, findings·가정·테스트 근거·한계를 기록했을 때 리뷰 작성 완료다. 병합 승인은 별개다.

## 검증과 유지보수
- 버전: 1.1.0. 유지보수 역할: Harness maintainer. 마지막 로컬 계약 검증: 2026-10-04.
- [평가 안내](../../evals/per_skill/README.md)에 따라 요청·diff를 보고 응답을 작성한 뒤 oracle을 실행한다.
- examples.jsonl의 expected는 채점용이며 평가자에게 미리 주지 않는다.
- 독립 모델의 행동 품질·모든 호스트 호환성을 검증했다는 뜻은 아니다.
- 반복 실패는 실제 실패 근거와 재현 사례를 먼저 남긴다. 적용 범위를 확인한 사례만 가이드와 회귀 평가로 승격한다.
