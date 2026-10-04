# TICKET: skill-quality-context

## Type
feat

## Goal
Improve review skill contracts, offline evaluation and focused loading while preserving safety.

## Scope
- Review skill metadata, completion rules and technology-specific guidance.
- Offline fixtures and response oracle; no generated expected responses claimed as AI evaluation.
- Focused technical-profile loading and reviewer skill loading, including explicit role.
- Entry checklist and regression tests.

## Out of Scope
- No removal/truncation of mandatory safety policies, provider requests, remote edits, Git release.
- Existing Jira speed work remains unchanged.

## Execution Plan
1. Clarify review scope, evidence and completion; separate stack-specific checks.
2. Add independently supplied response grading and fixtures; test missing/hallucinated findings and incorrect selection.
3. Keep safety files intact, load optional technical profile explicitly and review guidance for reviewer type/role.
4. Run focused tests, offline self-review, lint and Full verification; record boundaries.

## Acceptance Criteria
- [x] Review guide does not prescribe Java rules for unrelated stacks.
- [x] Offline grading rejects missed known defects, false positives and wrong selection.
- [x] Focused context keeps every mandatory policy and ticket; optional references are loaded on demand.
- [x] Reviewer role loads review guidance even when type is code.
- [x] Full verification succeeds; semantic quality and cross-platform claims remain bounded.

## Risk
Review instructions and context routing only; approvals and execution-policy gates remain unchanged.

## Verification Evidence
- Focused tests: 13 passed. Full plain suite: 314 passed, 0 failed, 0 skipped on Windows.
- Full coverage and lint passed; final record is rebound after this evidence update.
- Offline authored static responses: 7 fixture contracts passed. Same-agent, unblinded self-review; not an independent model benchmark.
- Self-review corrected the no-defect fixture to preserve function declaration/hoisting.
- Mandatory policies, missing-file failure and symlink/junction guards are preserved.
- Runtime smoke is not configured; these results do not prove live product behavior, macOS/Linux CI or all hosts.
- Existing Jira improvements are preserved. User review, commit, push and PR/CI remain pending.

- Final rebind initially failed once in the existing coverage step. Its saved summary matched a test title containing 'failed' and omitted the actual failing assertion; the exact cause is unconfirmed. A separately captured full coverage run passed without changing tests or thresholds. Keep this failure as an unresolved transient observation, not a fixed defect.
