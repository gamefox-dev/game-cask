# Trial brief template

`npm run trial:brief -- --game <file-in-original> --slug <slug> [--resume] [--scratch DIR]` fills the placeholders
below, writes the result to `reports/brief.md` and prints it. Hand the printed text to the porting agent as its task.
`npm run trial:record` stores the brief in `reports/trial.json`, so every trial is reproducible from the kit alone.
Everything between the `BRIEF` markers is the template; keep it short and point to the docs instead of repeating them.

<!-- BRIEF:BEGIN -->
# Trial brief: {{SLUG}}

You are the porting agent for a Game Cask trial. Port `original/{{GAME}}` (sha256 `{{SHA256}}`) with kit
`{{KIT}}`, following `CLAUDE.md` ("Port this game") and `.claude/agents/game-porter.md`. Brief written {{DATE}}.

## Independence
- Use only this repository's kit: its docs, skills, agents and tools. Do not read `archive/`, `../game-cask-trials`,
  or any other trial's port, reports, notes or screenshots.
- Use only your own fresh scratch directory: `{{SCRATCH}}`. Do not open files from other scratch directories, even if
  you come across them.

## User policies
- Binary-only: work from `original/{{GAME}}` and what the kit extracts from it, plus generic platform documentation
  (PE, x86, Win32 API contracts). No source code, other copies, or descriptions of the game's internals; no web
  search about the product. Obey any POLICY in `original/` files as well.
- Never execute the original or anything extracted from it on the host. Static analysis plus the kit's own browser
  builds only.
- No DRM, copy-protection or activation circumvention. If you meet any, stop and report it as blocked.
- No system installs. No git changes (no commits, branches, stashes or resets).
- The port stays private (`port/game.json` `"private": true`); `npm run leakcheck` must pass.

{{SLICE}}

## How to work
- The trial tests the kit. Report kit metrics first (pipeline summary, runtime metrics, oracle), then exceptions,
  then the work queue, then the game level.
- A level is a milestone, not the end. Every problem you observe goes on the work queue in `reports/progress.json`,
  localized to a layer. You are done only when every item is `fixed` (with proof), `authentic` (with binary evidence)
  or an `iteration-request` (a kit change you need; do not make it yourself, keep working on the rest). See
  `CLAUDE.md` → "Done means".
- Explore beyond your tests: the resource tour, `npm run probe`, and the visual checklist in `.claude/skills/browser-validation/SKILL.md`.
- Leave the developer's dev server on `:5173` alone. Tests and probes start their own servers.
{{RESUME}}
## Final reply
Lead with **Iteration requests** (or "none"): per item the id, symptom, evidence, layer, the concrete kit change in
Win32/API or ABI terms, and what you will verify once it lands. Then: kit metrics, exceptions, the queue (counts per
status), the achieved level per backend with test names, and anything blocked. Claim nothing you did not observe.
<!-- BRIEF:END -->

<!-- RESUME:BEGIN -->
## Resume mode
This continues an existing `port/` and `reports/` after a kit iteration. Before new work:
1. Read `reports/progress.json` (queue first), `reports/errors.json`, `reports/final-report.md`, and the newest
   "Kit … changes" section of `docs/verification.md` (it maps renamed metrics).
2. Rebuild and re-measure: `npm run build:port`, `npm run oracle -- port`, `npm run test:port`.
3. Re-check every queue item against the new kit. Iteration requests that landed become `fixed` (with proof) or are
   reopened with what is still wrong. Then continue the loop.
<!-- RESUME:END -->
