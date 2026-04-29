# Memory Governance

## 목적
- 에이전트가 `memory/*`를 일관된 규칙으로 읽고 쓰도록 표준을 정의한다.

## 공통 포맷
- 파일 형식: `UTF-8` Markdown (`.md`)
- 권장 파일명: `YYYY-MM-DD_<slug>.md`
- 문서 상단 frontmatter 필수:

```yaml
---
id: mem-2026-04-30-example
layer: working|semantic|episodic|procedural
title: 짧은 제목
owner: hoony
created_at: 2026-04-30
updated_at: 2026-04-30
tags: [sample, harness]
source: manual|agent|postmortem
---
```

## 레이어별 용도
- `memory/working`: 현재 태스크/스프린트 단기 맥락
- `memory/semantic`: 도메인 지식, 용어, 정책
- `memory/episodic`: 결정 이력과 회고
- `memory/procedural`: 반복 절차(SOP), 운영 런북

## 갱신 규칙
- 새 의사결정: `episodic/`에 즉시 기록
- 반복 작업 정착: `procedural/`로 승격
- 프로젝트 핵심 개념 변경: `semantic/` 갱신
- 진행 중 임시 맥락: `working/`에 기록 후 종료 시 정리

## 품질 규칙
- 하나의 문서에는 하나의 핵심 주제만 담는다.
- 근거 링크(파일 경로/PR/이슈)를 명시한다.
- 오래된 working 메모는 weekly 정리하거나 episodic/procedural로 이동한다.
