# TICKET: ops-followup-integration

## Goal
- Connect managed execution to durable Jira/Confluence follow-up drafts, remove ticket re-import friction, and repair missing publication without re-running implementation.

## Authorization
- User approved the remaining implementation including one-time scoped recording consent. The user explicitly selected mocked rehearsal. No live publication, commit or push approval supplied.

## Plan
1. Bind published local DRAFT tickets back to their Jira source without losing the implementation/test plan. Verify stale local/remote content rejection.
2. Capture execution outcomes and user review into durable follow-up intents. Generate bounded result/context drafts and explicit status mapping. Verify REVIEW_READY is not Done.
3. Prepare existing approved-outbox operations from intents; audit/recover local gaps and stale drafts without running code. Verify retry, unknown writes and deduplication.
4. Update the operator guide and run isolated integration/full offline tests. Actual account rehearsal remains pending credentials and publishing approval.

## Boundaries
- Remote writes require exact payload approval or a previously human-approved project recording scope. Scope cannot approve execution, human acceptance or Git. No automatic collection of source code, secrets or raw logs. No silent rewrite of remote context pages.
- Context/design explanations require agent-authored reviewed text; automatic summaries only claim recorded facts.
- No state-sync promise across computers. No measured labor-reduction claim.

## Acceptance
- [x] Local published ticket links in place and remains DRAFT until approval.
- [x] Follow-up intents survive restart and are reconstructable from local execution evidence.
- [x] Jira review and completed states remain distinct; stale intents cannot publish old state.
- [x] Confluence result/context drafts and status operations use existing preview/sync/reconcile safeguards.
- [x] Contract tests, review and operator guide complete; live rehearsal truthfully marked pending. Final Full verification is a separate required gate before any commit.

## Implementation Notes
- 2026-09-20: user approved MCP-first correction. Keep execution/approval/evidence gates, route managed calls through the official MCP endpoint with locally reviewed tool bindings; retain REST only by explicit opt-in. No actual account tools are connected in this session.
- Verification plan: mock JSON/SSE protocol, read/write routing, Jira freshness and existing approval/outbox regression; full offline verification before any release. Native host OAuth sharing/host adapter and live tool schema validation are not implemented or claimed.
- operations audit/repair/annotate/prepare feed the existing outbox. Optional consent preview/grant/revoke binds destination, account, mappings and allowed managed operations. operations flush and managed CLI hooks publish only within existing consent, never self-grant it.
- Runner start/finalization, managed command history and user review capture events. Capture failures warn and can be repaired from execution evidence without rerunning development.
- atlassian link preserves local plans; workflow discovery/configuration validates review vs Done category.
- Sixteen contract scenarios passed, including scoped recording, revocation, remote workflow changes, stale payloads, unknown writes, read-only isolation and runner integration. Full offline verification is recorded separately in observability/metrics/ops-followup-integration.verify.json.
- Guide section 14 documents the complete flow and remaining live-account/other-OS validation. No actual account scope was granted. The user explicitly requested a mocked rehearsal instead.

## Live contract correction (2026-09-21)
- User authorized fixing live MCP defects and scoped synthetic revalidation. No Git release approval.
- Normalize Confluence creation/content/ancestor evidence; compare only generated ticket JSON across ADF/Markdown; resolve transitions from project/work-type evidence and recheck before/after writes.
- Verification: sanitized real-shape fixtures, negative evidence, existing regressions, Full offline verify, managed live reconciliation/create-link/state checks. Never replace an uncertain receipt with guessed success.

## Release review (2026-09-27)
- The earlier no-release-approval notes describe the authorization at the time of implementation. The user now explicitly requests completing the outstanding release checks, merging to main, and aligning the IntelliJ checkout with main.
- Scope of this release: the live MCP contract correction, its tests, and accurate documentation. Full operational account rehearsal and AX time measurement remain separate, unverified work; this release does not mark those criteria complete.
- Before merging: Full offline verification, clean diff review, and GitHub cross-platform/security checks must pass.

## Operational Review
- [ ] standing-consent 전체 실계정 운영과 최종 사용자 검수

구현 병합과 운영 수락은 다르다. 원문과 과거 근거는 보존하며 현재 완료·사용자 승인으로 재해석하지 않는다.
