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

## 실행 경로와 보장 범위

- `node tools/harness-cli/index.js memory check`: frontmatter와 경로 규칙을 독립 검사한다. 위반 시 파일·원인·이 가이드 경로를 출력하고 실패한다.
- `check`에도 같은 진단을 표시한다. `verify --full`은 검증 명령 실행 전과 성공 기록 직전에 검사하며, 위반 시 `last_full`을 실패로 기록하고 성공 지문을 발급하지 않는다.
- Quick 결과는 Full 실패를 덮어쓰지 않는다. 일반 `complete-task`의 현재 콘텐츠 검사에도 연결되어 Git ignored 메모리의 형식 오류를 과거 성공 기록으로 우회하지 못한다.
- 네 레이어 안의 중첩 폴더도 검사하며 알 수 없는 루트 레이어, 레이어 밖 Markdown, symlink/junction은 거부한다. `README.md`, `MEMORY_TEMPLATE.md`는 메모리 노트 검사에서 제외한다.
- 이 검사는 **파일 형식과 경로 검사(Linter)**다. 내용의 사실성, 최신성, 요구사항 충족을 보증하지 않는다. OS 수준 쓰기/명령 차단이 아니며 raw Git 및 기존 명시적 `complete-task --force` 우회까지 통제한다는 뜻도 아니다.
