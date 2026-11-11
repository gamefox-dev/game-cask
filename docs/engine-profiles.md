# Engine profiles (K45)

Game Cask has **two separate paths**. Systematic lifting remains the default and main path:
extract → analyze → lift → platform profile → BGT → oracle. An **engine profile** is an explicit
opt-in: inspect a known engine's exact version/build, extract its data pack, and pair it with a
hash-verified official web runtime. It is not a port of that engine to the BGT ABI.

## Policy, authenticity and boundaries

* Engine profiles require **operator-side authorization outside port/**. The operator runs
  trial:brief with --allow-engine-profile (which records a checked marker in reports/brief.md
  bound to the trial slug and input runner SHA-256),
  or writes .engine-private/authorizations/<game-id>.json. The build refuses otherwise, even if
  the porter sets engineProfile.allowed=true. The porter may select but must not grant/edit
  authorization. Mixed pipeline/engineProfile and unknown versions/features are refused.
  Existing lifting behavior is unchanged.
* Game logic and assets are not rewritten. Embedded extraction may change **only directory
  offset words** to rebase them to a standalone pack; every per-file MD5 is checked before use.
  Source, standalone-pack, runner, runtime archive/member and notice SHA-256 values are retained.
* Runner version/build signatures corroborate identity but can be forged. A custom engine fork,
  missing export modules or platform-dependent scripts can still differ. Detection is not a
  compatibility proof or a claim that signatures authenticate an arbitrary binary.
* No DRM/activation/encryption bypass. Unknown/encrypted pack formats and encrypted scripts are
  refused. Possession is not permission to redistribute a game. Operator authorization and the
  game's own rights remain necessary. This kit makes **no redistribution clearance claim**.
* Runtime archives, extracted runtimes, packs and engine builds are private/local-only and never
  committed. Default storage is .engine-private/; leakcheck rejects it even if force-staged,
  PCK extensions/signatures, known runtime filenames, and renamed allowlisted runtime hashes.
  Do not publish a generated pack or screenshots without reviewing the game's rights.
* Godot is MIT-licensed but bundles third-party components. The operator-provided official
  3.5.3-stable LICENSE.txt and COPYRIGHT.txt are separately hash-pinned and copied into every
  local build. A runtime cannot be provisioned without pinned notices. Redistribution requires
  a separate review of these notices, runtime dependencies, and game rights.

## Offline provisioning

No command downloads a runtime. A reviewer approves provenance, exact build and full archive
SHA-256 in tools/engine/runtimes.json. A hash calculated from an untrusted download alone does
not establish official provenance. Runtime and notice changes need review.

    npm run engine:provision -- godot-3.5.3 /offline/webassembly_release.zip /offline/notices
    npm run engine -- doctor godot-3.5.3

The last argument defaults to the archive's directory; it must contain the pinned notice files.
Provisioning checks the archive before safe ZIP extraction, checks every runtime member, retains a
receipt, and atomically publishes the runtime. Subsequent builds reverify member hashes against
**the checked-in allowlist**, not merely a mutable receipt. There is no nearby-version fallback.
The non-threaded 3.5.3 runtime requires WebGL 2, not WebGPU. Its audio worklet is retained; its
service-worker/offline-template files are retained but no service worker is registered by the shell.

## Port config and workflow

Operator-written authorization outside port/ (alternative to the trial:brief flag):

    { "schema": "game-cask/engine-authorization/1", "game": "mygame", "runnerSha256": "<64 hex>", "allowEngineProfile": true }

Place it at .engine-private/authorizations/mygame.json, never in port/. This is an operator
workflow boundary, not a cryptographic defense against a malicious agent with write access.
Do not allow a porting agent to create/edit the policy or its trial brief. Both authorization
forms must match the game id and whole runner SHA-256; stale/cross-game grants are refused.
If trial:brief names an installer, the operator must separately authorize the extracted runner
hash using the outside policy. The porter cannot transfer an installer grant to another binary.

Runner/pack.from paths are relative to inputRoot, which is relative to the config directory
(default ../original). Input traversal and symlinks are refused. Use a dedicated input directory:
native side libraries and extra packs anywhere in the inspect inventory block the build.
Pack sha256 means the **normalized standalone** pack hash; runnerSha256 means the whole runner
file hash (including an embedded pack). Detection prints both source and normalized hashes.

Example port/game.json (hash placeholders are not valid hashes):

    {
      "id": "mygame", "name": "My Game", "private": true,
      "engineProfile": {
        "schema": "game-cask/engine-profile/1", "allowed": true,
        "adapter": "godot3", "runtime": "godot-3.5.3",
        "version": "3.5.3", "build": "6c814135b69d4e703956bacc2073b4b179ff5a00",
        "inputRoot": "../original", "runner": "game.exe", "runnerSha256": "<64 hex>",
        "pack": { "location": "embedded-trailer", "sha256": "<64 hex>" },
        "renderer": "webgl2", "threads": false, "width": 640, "height": 360
      }
    }

For an adjacent/explicit standalone pack, use pack.location="adjacent" or "explicit" and
pack.from="game.pck". Adjacent packs must be beside the runner. Multiple packs are not supported
yet. The runner still needs exact version/build evidence; a PCK header alone identifies an
exporter, not an official runner.

    npm run engine -- detect original game.exe
    npm run engine -- detect original game.exe game.pck
    npm run engine -- extract original game.exe game.exe .engine-private/extracted/mygame
    npm run build:port
    npm run engine -- serve .engine-private/builds/mygame
    npm run engine:probe -- .engine-private/builds/mygame ./explore.mjs
    npm run test:engine

Extract refuses to overwrite. Keep outputs private, outside original/ and input directories.
Build produces a separate engine manifest and launch shell; it never invokes the lifter or changes
BGT code. Trial records and probes identify executionPath/path=engineProfile, runtime id, and
hashes. No pipeline instruction/LOC/oracle metrics are fabricated for an engine build.

## Godot 3 adapter support

The initial adapter supports Godot 3 **PCK format 1**, exact 3.5.3 stable official build only.
It locates a header at zero or derives an embedded header from the final 12-byte GDPC trailer;
it never trusts an incidental GDPC string in runner code. It validates header/reserved fields,
counts, safe UTF-8 paths, duplicate/case-colliding names, directory bounds, safe 64-bit offsets,
file ranges/non-overlap, and every stored MD5. Hash-verified absolute or pack-relative embedded
offsets are accepted; only absolute offsets need rebasing. Inputs are bounded to 2 GiB and
100,000 pack entries; these are implementation limits, not format claims.

Explicit blockers include native/GDNative libraries, Mono/C#, encrypted formats/scripts, threads,
additional packs, unknown runner signatures and version/runtime mismatch. Known script-level
platform/thread usage is conservative. Text resources are scanned in bounded, overlapping chunks across the **entire** resource,
not only its prefix. Text heuristics supplement structural detectors; they are not a complete
feature inventory. Compiled .gdc scripts remain allowed because normal exports use them, but
the detection/build report emits **feature-scan-incomplete** and a compiled-GDScript warning:
bytecode/dynamic scripts can use unsupported functionality. Structural GDNative, native library,
Mono/assembly, encrypted pack/script and known thread-build detectors remain fail-closed.
Browser boot, input-induced visible change and no runtime errors are mandatory before **any**
level claim; static detection/build success is not L1.

## Browser tests/probes and unsupported BGT capabilities

The tests/support/engine-profile.ts adapter opens a served build, injects trusted Playwright DOM
keys, observes RAF intervals, and collects console/page/HTTP/request failures. Install
`await collectEngineErrors(page, runtimeById(id).fileHashes)` before navigation, then
`await capture.finish()` before asserting errors; attach its requests and body evidence.
Use the checked-in allowlist hashes, not mutable build/port-provided expected hashes.

Godot 3.5.3 wraps the original fetch reader in a progress stream, then tees/clones that
response for instantiation. Chromium can report `net::ERR_ABORTED` at this stream handoff/EOF
after receiving the entire wasm, before engine startup (not page/server shutdown). Test/probe
capture observes the original reader without replacing responses or disabling
streaming compilation or changing official runtime bytes. A cancellation is classified as
**canceled-after-complete** only for HTTP 200, EOF already observed at cancellation, positive
Content-Length equal to all received bytes, and SHA-256 matching the pinned runtime member.
The cancellation and its full evidence remain in the report. Each captured same-origin
runtime fetch gets a unique diagnostic request-header token, allocated before response headers
and bound to its Playwright Request; evidence is never selected by URL. A repeated URL cannot
borrow another request's EOF/hash. This instrumentation exists only in test/probe capture:
production shells are unchanged, cross-origin requests get no token/preflight, and the token is
not exposed to the engine/game. Partial, early, HTTP-error and
wrong-hash responses still fail; unrelated request failures are never ignored. All observed
runtime bodies are hash/length checked even without a cancellation. This narrowly classifies
a loader/browser cancellation, not a generally tolerated asset error. The shell exposes
a compatible **observation subset** of __BGT_TEST__ so existing screenshot, readPixels,
captureRegion/expectChange, input, diagnostics and probe helpers can be reused.
The engine:probe command uses the existing makeProbe facade and normal script style.

**Not supported:** pause, deterministic stepping/seed replay, peek, savestates, command injection,
BGT resource tours, trace oracles, guest coverage, retirement and BGT CPU profiling. These throw
explicit errors or report null capability data. On this adapter step(n) means **observe n RAFs**,
not execute n game updates; the game remains free-running. stateHash() returns null.
Timing is browser **display cadence**, not engine FPS, simulation ticks, GPU duration or CPU cost.
No Safari/iPhone/audio/persistence/network compatibility is claimed by the CC0 smoke test.

Serving binds only 127.0.0.1 on BGT_E2E_PORT (never 5173), snapshots and hash-checks only
manifest-allowlisted files, rejects traversal/symlinks, sets wasm/JS/PCK MIME types, and blocks
external connects/frames with CSP. Threads profiles require COOP same-origin/COEP require-corp;
this allowlisted runtime has no thread worker and requires neither. Run untrusted games only in
an isolated browser/host sandbox with no credentials; localhost/CSP is not an OS security boundary.

The original CC0 writer in tests/fixtures/engine/godot3-fixture.mjs creates ECFG project.binary,
text scene/GDScript, standalone PCK, and a non-executable stub runner with an appended pack.
No native editor or game files are required. The built-in fixture authorizes only its fixed CC0
fixture id, outside its generated config directory. E2E checks red→cyan pixels from Enter, screenshots,
and unfiltered RAF timing. It skips **only** when no runtime is provisioned; corrupted provisioned
artifacts fail. npm test parser/policy/server tests never require the runtime.

## Adding another engine adapter

1. Register an adapter in tools/engine/framework.mjs: pack discovery/parse/hash validation,
   runner identification, unsupported-feature detectors and shell generation. Consume
   game-cask/inventory/1 inspect output plus hash-bound read-only inputs. Do not execute runners.
2. Specify exact engine/build, supported pack locations/normalization and hard bounds. Add CC0
   fixtures and negative tests for malformed/untrusted inputs. Avoid game-dependent branches.
3. Obtain reviewed official runtime provenance and archive/member/notice hashes. Add a reviewed
   offline allowlist entry; never distribute the archive in Git. Define MIME, renderer, worker
   and cross-origin-isolation requirements explicitly. Do not silently substitute engine releases.
4. Add a browser observation adapter/shell, boot+input visual test and timing/error evidence.
   State unsupported BGT capabilities and unresolved platform features honestly.
5. Document authenticity/licensing boundaries and obtain policy review before enabling the adapter.
