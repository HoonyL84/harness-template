# TICKET: jira-operation-speed

## Type
feat

## Goal
Reduce Jira read/write round trips without weakening verification and approval.

## Scope
- Jira-only structured search, same-command MCP catalog reuse, priority batch preview/apply/reconcile.
- Exact JSON equivalence for variable-length Markdown fences.
- Record approved GAME rehearsal relationships separately from Git commit dependencies.

## Out of Scope
- No daemon, credential/session persistence, stale issue cache, arbitrary Jira edits, automatic uncertain-write retry or Git release.

## Execution Plan
1. Search and session reuse; verify pagination/filter/parallel catalog fixtures.
2. Approved priority batch; verify exact digest, fresh snapshots, partial failures and read-only reconciliation.
3. Markdown contract repair; reject changed JSON and mismatched fences.
4. Full tests/lint/coverage and live read-only probes; relate approved GAME tickets with remote confirmation.

## Acceptance Criteria
- [x] Jira-only search never queries Confluence and returns fresh filtered issues.
- [x] One request-scoped client initializes and lists schemas once, including concurrent reads.
- [x] Four changed priorities require two batch reads and four writes during apply; no-op writes skipped.
- [x] Stale/replayed approvals and uncertain writes cannot be resent.
- [x] Exact four-backtick JSON descriptions link successfully without ignoring content changes.
- [x] Approved GAME relations are verified; no game implementation or Git commit/push.

## Risk
External writes limited to explicitly approved fields/issue relationships. Partial/uncertain outcomes remain inspectable.

## Verification Evidence
- Full verify: coverage thresholds and lint passed on Windows.
- Plain suite: 307 passed, 0 failed, 0 skipped (includes CLI smoke).
- Request-count regression: apply for four changed priorities uses 2 batch reads + 4 writes; preview and MCP setup excluded.
- Live Jira-only High/To Do search: 3 issues, no Confluence query; measured network time ~2.8 seconds in one observation.
- Live priority no-op validation: 4 current approved values retained, 3 tool reads including preview, no remote writes, ~5.1 seconds in one observation.
- Existing GAME-1~8 exact JSON body links restored through managed link validation.
- 15 approved Relates links added and observed; status and priority unchanged. Related links are not code dependency gates.
- No game source changes, game execution, Git commit, push, merge or GitHub CI run.
- User review and Git release remain pending. Local connection bindings and real-account IDs remain ignored and are not in the source diff.

## Completion
- Completed At: 2026-10-04T02:13:41Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
