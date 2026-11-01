# K6e — privacy scanner robustness and FIFO heavy-command gate (Q13, harness item)

Generic kit tooling; no game, `platforms/`, `bgt/` or ABI changes, no private trial bytes copied, no new dependencies,
no web access or pushes. Base ca2cd17, branch `lane/K6e`.

## Q13 — bounded-stack, linear report/leak scanning

**Root cause.** V8 keeps one backtrack entry per iteration of a greedy `{n,}` loop and throws
`RangeError: Maximum call stack size exceeded` once ~64 MB is exhausted. This was not limited to the large-base64
regex: on a 12M-character input the large-blob rule, `OpenAI-style key`, `generic secret assignment`, GitHub /
Anthropic / Slack token tails, the Windows and Unix user-path runs, the email domain match and the hex-dump line
regex all overflowed (confirmed per rule before the change; every one of them is covered by a regression now).

**Change (`tools/report/scan.mjs`, used by `redact.mjs` and `leakcheck.mjs`).** Every rule is an explicit scanner:
a regex finds only a short, bounded *anchor* (`sk-ant-`, `/Users/`, `token`, ...); the unbounded run after it is
consumed by a char-code loop and the regex tail semantics (word boundary, closing quote, last-dot-then-2-letters,
`={0,2}`, hex-pair repetitions) are applied directly. Stack use is O(1), time is O(n), and nothing is skipped before
other rules (embedded secrets, emails and paths inside and around huge tokens are still found and redacted).
Because the whole string is one pass there are no chunk boundaries to straddle; a token is found wherever it
starts (tests exercise offsets around 64 KiB / 1 MiB boundaries and tokens assembled from separately produced pieces).
`SECRET_PATTERNS` keeps `name` and `re` (documentation/reference) and gains `find(text)`; leakcheck uses
`hasSecret`. Rule names, samples, redaction notices (`<redacted base64 blob, N chars>`, `<redacted-secret>`,
`<email>`, `~/`) and allowlists are unchanged.

**Equivalence evidence.** `tests/unit/privacy-scan.test.ts` keeps the former regex implementation as a reference:
10,000 seeded adversarial strings (anchors, whitespace, quotes, unicode whitespace, paths, emails, hex lines) must
give identical redaction, identical secret/email/path/blob verdicts, plus the 2046..2049-character blob threshold
with 0..3 `=` pads. Offline I additionally ran 300k strings (several seeds) against the old module: 0 differences.

**Regressions (`tests/unit/privacy-scan.test.ts`).** 8M and 12M ASCII tokens (time and memory bounded, and a fresh
`node` process with the default stack, the reported repro); 31 adversarial 8M-character shapes (every rule's long-run
failure mode); every secret kind embedded between 6M-character tokens; items placed at and around 64 KiB / 1 MiB
offsets; an unmodified ~19.4 MB Playwright-style JSON (9.75M + 9.60M-character inline base64 attachments) scanned,
redacted, reparsed with outcomes/stats intact and clean afterwards; leakcheck on 12M-character text files; hex-dump
boundaries. Typical timings on a loaded machine: 12M-character scan+redact 0.15 to 0.5 s (the old code threw);
the tests allow 5 s.

## Harness — FIFO machine-wide heavy gate (`tools/harness/pi/shim/heavy.sh`)

- **FIFO.** Each heavy waiter takes a ticket `<sec>.<usec>-<pid>` in `$PREFIX-queue`
  (`/private/tmp/bgt-heavy-v1-queue` by default) and only the oldest live ticket may try the slots. The ticket is
  removed by the command itself the moment it holds a slot (inside the `--execute` leg), so the next waiter becomes
  head immediately. Unlike the operator prototype, ordering is by microsecond timestamp, not second then pid.
  `perl` provides the timestamp; without it the second-resolution `date` is used.
- **Stale cleanup.** Every loop removes tickets whose pid is gone or whose recorded process start time no longer
  matches (pid reuse). Signals INT/TERM/HUP remove the waiter's own ticket.
- **Slot count re-read every loop** from `$BGT_HEAVY_SLOTS_FILE` (default `$PREFIX-slots`, one integer) over
  `$BGT_HEAVY_SLOTS` (default 2). Invalid values are still refused with `invalid BGT_HEAVY_SLOTS`. No user paths are
  hard-coded; locks must still live under `/private/tmp`.
- **Stricter matching.** Heavy is decided from the parsed command, not substrings of any argument: `npm test|t|tst`,
  `npm run <test|build|lint|oracle|bench|probe>[:suffix]` (npm flags with values such as `--prefix`, `-w` skipped),
  `npm exec`/`npx` of `playwright|vitest|eslint`. `npm install vitest`, `npm view @playwright/test`,
  `npm run typecheck`, `npm pkg get scripts.test`, `npm run buildinfo`, `npm run dev -- --host testing`, `npx tsc`
  are now pass-through. `BGT_HEAVY_CLASSIFY=1` prints `heavy`/`light` without running anything (test hook).
- **Tests (`tests/unit/pi-harness.test.ts`, 5 new):** classification table (14 heavy, 13 light), strict oldest-first
  service of five staggered waiters with no overlap and an empty queue afterwards, dead-pid and reused-pid ticket
  removal while a genuinely live older ticket still blocks, slot file raised mid-wait starts a waiter while the first
  is still running, ticket removal on SIGTERM.
- **Ownership exception (one):** the existing `serializes heavy npm/npx...` test invoked `npx run test`, which only
  matched through the old substring rule. It now invokes `npx vitest run` (assertions unchanged).
- Known limit: a waiter that has taken its timestamp but not yet created its ticket can be overtaken by one created a
  few milliseconds later (the head check is not atomic with ticket creation). Slot exclusion itself (lockf) is unaffected.

## Verification

Run on the final tree through the operator gate with `BGT_E2E_PORT=5215` (never `:5173`).

| Gate | Result |
| --- | --- |
| `npm run doctor` | ready |
| `npm run lint` | exit 0 (ESLint, host GCC, example check-builds) |
| `npm run typecheck` | exit 0 |
| `npm test` | **590/590 tests, 53/53 files**, zero failed (K4b baseline 522; this lane adds privacy-scan and 5 gate tests, plus inventory growth from integration) |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **200 passed / 51 skipped (unchanged intentional skips) / 0 failures** |
| `npm run leakcheck` | pass; **463 committable files** before this handoff |
| pipeline oracles, explicitly 300 frames | **20/20 identical, 6,000 frame pairs**, requested=compared=frames=300, exitStatus 0 |

Oracle inventory: win32-conformance, win32-hello, x64-audio, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt,
x64-gl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls,
x86-handles, x86-threads (x64-handles and x86-handles are new since K4b's 18).

The first `npm test` of the final tree failed two unrelated tests on timeouts while the shared machine was saturated
by other lanes (`x64-semantics` beforeAll 10 s hook, `build-chunks` native-scale 120 s test); the unmodified rerun passed 590/590 with no changes in between.

## Open items

- Browser evidence is local Chromium only. Raw private reports were not used; all measurements are synthetic.
- Operators using the old `/private/tmp/bgt-heavy-queue` + `bgt-heavy-slot-N.lock` prototype and this gate
  (`bgt-heavy-v1-*`) at the same time do not share slots; use one or the other.
