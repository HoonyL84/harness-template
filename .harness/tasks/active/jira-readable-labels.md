# TICKET: jira-readable-labels

## Type
feat

## Goal
Use human-readable Jira topic labels without breaking reconciliation markers.

## Scope
Approved GAME-1..8 label enrichment, optional request labels, publication/search and PM guidance.

## Out of Scope
No status/priority/description changes, execution, marker removal or Git release.

## Execution Plan
1. Read current eight issues with labels and related metadata.
2. Preserve existing labels; add approved readable topics and shared rehearsal group with labels-only MCP edits.
3. Batch-read remote state to confirm labels and unchanged status/priority/description/links.
4. Bind optional labels to request approvals/publication, add exact label search and guidance.
5. Regression tests, full verification and user review.

## Acceptance Criteria
- [x] Approved GAME labels are remotely verified and existing tracking markers preserved.
- [x] Human labels survive plan creation/publication and are fingerprint-bound.
- [x] Label search is exact and project-scoped; unsafe names fail before remote access.
- [x] Full verification passed for the implementation; Git release is separately approved.

## Verification Evidence
- Official MCP labels-only edit of GAME-1..8: remotely VERIFIED, all original markers retained. Status, priority, summary, description and relationships unchanged.
- Topic labels: 기반점검/체험기획/에셋설계/맵설계/대화설계/저장복구/다국어오디오/검증정리; shared group 체험리허설.
- Focused tests: 20 passed; lint passed.
- Final Full result is tracked by observability/metrics/jira-readable-labels.verify.json; unchecked Full item remains pending until recorded success and next ticket review.
- No game execution, commit, push or merge. Existing Jira and skill changes preserved.

## Approved Follow-up
- User approved summary-only removal of [HARNESS REHEARSAL] from GAME-1..8. Other fields remain unchanged.
- Future titles describe the actual task without unsolicited tooling/rehearsal prefixes.
- Summary changes intentionally stale the prior Jira input snapshot; import current inputs before execution approval. Do not silently rewrite source fingerprints or approve execution.

## Release Follow-up (2026-10-04)
- User approved committing and pushing the accumulated Harness changes after the game documentation release.
- Windows Full coverage and lint passed for the combined source changes before release. A current Full record is required again before task completion.
- Earlier no-game-execution and no-Git statements describe the original implementation phase, not the later separately approved game rehearsal and release.
