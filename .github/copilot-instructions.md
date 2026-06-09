# Repository Instructions for GitHub Copilot

This repository uses `AGENTS.md` as the source of truth for agent behavior.

Before making code changes, read these files in order:

1. `AGENTS.md`
2. `docs/project/PLANS.md`
3. `docs/design-docs/core-beliefs.md`
4. `docs/design-docs/tech-stack.md`
5. The active task plan in `.harness/tasks/active/`, when one exists

Follow these operating rules:

- Prefer minimal, surgical changes that are directly traceable to the user request.
- Do not add speculative features, abstractions, or refactors.
- Preserve the existing style of the file being edited.
- If a task is ambiguous and the choice has non-obvious consequences, stop and ask.
- Use `skills/<skill_name>/SKILL.md` for portable agent skills.
- Use `docs/skills/` for longer legacy procedure documents.
- Run `bash scripts/verify-task.sh` before committing when the environment supports Bash.

Repository-specific notes:

- This template is cross-project and intentionally keeps many project files as placeholders.
- Windows users should run shell scripts through WSL or Git Bash.
- Keep documentation in the language already used by the file.
