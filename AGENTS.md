# Game Cask agent entry point

Read [CLAUDE.md](CLAUDE.md) before working. It is the single source of operating rules for **all** agent harnesses.
Skills live at `.claude/skills/<name>/SKILL.md`; `.agents/skills` exposes the same files, not a second copy.
Agent role briefs in `.claude/agents/` are ordinary Markdown instructions; load them by path even if your harness
has no agent-dispatch tool. Use a fresh independent session for validation; never claim delegation that did not run.

Trial setup and harness commands: [docs/trials.md](docs/trials.md).
