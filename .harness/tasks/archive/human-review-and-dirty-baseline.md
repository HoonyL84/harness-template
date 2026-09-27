## Goal
- Prevent managed execution from silently omitting uncommitted project content.
- Require a current accepted human review before managed Git release operations.

## Scope
- One branch, one ticket. Preserve unrelated local files and existing project changes.
- No automatic stash, reset, clean, commit, push, or merge.

## Verification
- Dirty project execution blocks before worktree creation and preserves the original file.
- Missing or rejected review blocks managed commit; a later rejection invalidates a pending approval.
- Accepted review permits a separately approved commit and subsequent separately approved push.
- Full harness verification passes before any commit request.

## Completion
- Completed At: 2026-09-27T06:36:43Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
