# TICKET: optional-multi-agent

## Type
feat

## Goal
- Add optional multi-agent orchestration without changing the default single-agent workflow.
- Keep the same role artifacts and safety gates across Codex native delegation, provider API calls, and sequential host-driven execution.

## Decisions
- Multi-agent execution is disabled by default and requires explicit opt-in.
- Phase 1 parallelizes read-only roles while keeping a single workspace writer.
- Phase 2 permits multiple writers only with explicit opt-in, isolated worktrees, disjoint path ownership, and one verified commit per worker.
- Reviewer and Verifier remain separate from implementation.
- Integration, high-risk changes, cleanup, and final completion remain approval-gated.

## Execution Flow
```text
User Goal
  -> Planner + Architect (parallel when supported)
  -> Orchestrator freezes the plan
  -> Implementer (single writer by default)
  -> Reviewer + Verifier
  -> verify --full
  -> Orchestration finish
  -> complete-task
```

Sequential fallback emits one role request at a time. The interactive host or user executes that request and records the normalized artifact before the next role request is created.

## Scope
- Capability detection and adapter selection
- Versioned role artifacts and atomic orchestration state
- Native-host, provider-API, and sequential-local execution contracts
- Optional worker branch/worktree isolation
- Review, integration, approval, recovery, and final verification gates
- Documentation and regression tests

## Out of Scope
- Unbounded agent spawning
- Multiple workers editing the same file
- Automatic conflict resolution
- Automatic high-risk changes, commits, pushes, or merges
- Provider-specific orchestration logic in the core state model

## Acceptance Criteria
- [x] The existing single-agent flow is unchanged while multi-agent mode is disabled.
- [x] Capability detection selects native, API, or sequential fallback without guessing from command presence.
- [x] Planner/Architect and Reviewer/Verifier use normalized artifacts.
- [x] Sequential fallback creates one host-driven role request at a time.
- [x] Multi-writer execution requires explicit opt-in and disjoint owned paths.
- [x] Worker commits are verified against base SHA, branch head, ownership, and diff hash.
- [x] Review findings, conflicts, approvals, or stale verification block completion.
- [x] Only a current `verify --full` result can finish orchestration.
- [x] Orchestration state tampering is detected.
- [x] Unit tests and Windows smoke verification pass.

## Follow-up Experiment
- Run the native-host role flow against Tiny Notes after this implementation is committed.
- Compare native-host and sequential-local results using the same acceptance criteria.
- Record any friction as a separate harness improvement ticket.

## Completion
- Completed At: 2026-06-13T11:19:16Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
