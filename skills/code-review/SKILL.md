---
name: code-review
description: Review code changes, PR diffs, or local modifications for bugs, regressions, missing tests, and behavioral risks.
version: 1.0.0
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

## 목적
- 변경사항에서 버그/리스크/회귀 가능성을 식별한다.

## 입력
- PR diff, 관련 테스트, 요구사항

## 출력
- severity 순으로 정렬된 finding 목록
- 각 finding은 파일/라인/근거/수정 제안 포함

## 실행 절차
1. 요구사항 대비 동작 회귀 가능성 확인
2. 예외 처리/경계값/동시성/성능 리스크 점검
3. 테스트 누락 여부 확인
4. finding 없으면 residual risk 명시
