# Integration I12 — K21 + K22

**In progress; no finish-line acceptance yet.** Branch `integration/p1`, base dev.14 `4bcc068`.
No push, game inputs, installs or test weakening. Asyncify remains default.

## Merge and integration decisions

1. `0fdc7c3`: `--no-ff lane/K21` (`3a8b1bb`).
2. `3be7551`: `--no-ff lane/K22` (`599c059`). Only textual conflict was `docs/v03-status.md`;
   retained both lanes, then corrected K21's stale checkpoint summary from its final handoff.
3. `1c7da8e`/`d7dd09b`: K21 execution summaries/probe console and coverage snapshot metrics now identify
   K22's **active** variant. Normal unsupported Node still verifies JSPI-only rejection/preferred fallback.
4. `ff5e905`: K22 partition assembly uses `wasm-names.mjs`; K18 post-link cache identity now includes it.
   Extracted the complete production key for an isolated input-sensitivity regression. Other parser/runner/
   Binaryen/feature/name/remove inputs remain included; thresholds/local passes live in hashed implementation.
5. `5a7a8ff`: force 64 KiB partitions in the small convergence fixture, without changing production thresholds.
   The first diagnostic attempt's 1 MiB target produced just one shard; its assertion correctly failed.

Evidence inbox files are enumerated/read/identity-validated on **each** pipeline build. Selected owners key both
monolithic/chunked lifts; source/dependencies key objects; linked bytes key Asyncify. No evidence/config-only
shortcut can return a stale selected module. Metadata-only provenance updates need not recompile identical code.
JSPI-only bypasses postprocess; preferred emits dual artifacts; both share the same pipeline selection.

## Review boundary

Inherited external **vK21b PASS /vK22b PASS**. Reviewer explicitly read `3be7551..ff5e905` repair diff and
judged it narrow/correct; requested lane reviews + diff read + integrator merged-tree gates in this handoff.
**No separate independent merged-tree review/PASS or CI run is claimed.**

## Additional integration defect: Binaryen writer type order

The 64 KiB four-mode convergence regression found a real fail-closed partition rejection on K21's
interpreter observation build: shards1..12 matched, shard13 changed type/import/function section indices.
Function maps and all five Asyncify helpers were byte-identical. No unsafe assembly/publication occurred.
Binaryen's writer defaults to usage-frequency type order even without the reorder-types pass; shard-local
body usage differs. `29b3951` pins `--preserve-type-order` on partition children, keeping **all original strict
assembly checks**. Exact isolated CC0 reproduction before fails at shard13; after completes16/16 with equal
sections/maps/helpers and V8 validation. Full multi-shard convergence rerun is queued, not yet PASS.
This is integration breakage exposed by combining K21's new module shape with K22's partitioner, not a
new optimization or changed global default. Hashed partition implementation automatically invalidates cache.

## Verification — pending

- Focused diagnostic: **12 pass /1 fail**; only forced-partition fixture selected one shard at 1 MiB.
  Repaired to64 KiB, preserving >1 assertion. Original typecheck caught missing Window typing in the new
  browser assertion; repaired before gate sweep. These diagnostics are not final acceptance.
- Current source implementation: `29b3951`. Full serial driver `reports/i12/gates.sh` records every exit/log/time.
  Full units run real Node JSPI with600000ms CLI budget, no exclusions. Browser runs require WebGPU and both
  backends in Asyncify then JSPI mode, port5260, never developer5173. Oracles enumerate every pipeline game.json,
  300 updates each in both modes. Reduced scale is1044 owners/1800 rounds, production default thresholds.
- Focused convergence fixed runner root30710: `reports/i12/convergence-fixed.{log,exit}`.
- Isolated negative controls root25485: `reports/i12/mutation-before.{log,exit}`; private archive under
  `$BGT_TRIAL_SCRATCH/mutation-kit` mutates only copied snapshot variant/key parser input, never source tree.
- The pre-repair gate root38494 completed doctor only; its lint was still queued when paused/canceled, with
  no writers. Only those recorded owned roots were signaled (38494,82970). No shared queue/lock was deleted.
- **Current final gate driver root48853**, `reports/i12/gates-final.sh`, waits for **convergence-final root33235**
  then writes fresh `reports/i12/final/*` logs/exits/timestamps/source commit+tree. Earlier waiting driver33249/
  33252 canceled before any gates to correct its dead-wait boundary. Original74579 ran no gates (shell parse
  error); all diagnostics preserved. Final driver passes bash -n, no source edits planned after29b3951.
- Full matrix remains doctor/lint incl scale/clang/types/units/both browsers/leakcheck/64 oracles/reduced scale.
  Negative controls actually failed **3/3 as intended**: two missing snapshot active modes, one omitted name
  parser identity. Logs retain exact assertion failures. Private archive can now be removed.
- Audit tool: `node reports/i12/audit.mjs`; pending/failed gates must not be called PASS. Preserve original
  failures. Finalize compact evidence, this handoff/status, leakcheck, commit after all results.

## Remaining work / cleanup

Inspect runners before deleting owned scratch. Verify real four-mode convergence, no unexpected browser skips,
32×2 oracle traces/errors/interp/stubs and cross-variant hashes, reduced scale300 checks/10,500 yields. If any
production repair lands, rerun final-source gates. Remove archive after negative controls exit and scale wasm
only after hashes/oracle saved. Do not delete shared caches/locks or other lanes' work. Hardware/mobile not certified.
