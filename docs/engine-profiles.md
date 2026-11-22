# Engine runtimes (engine profiles, K45 → K55)

Game Cask has **two port paths**:

1. **Engine runtime (fast path, default when it applies).** `npm run inspect` detects a known engine and its exact
   version/build. If an adapter and an official web runtime of that exact version exist and nothing blocks it, the
   unchanged game pack runs on that official runtime (e.g. Godot's own web export template). A real Godot 3.5.3
   game ran at 60 fps this way versus ~5 fps lifted.
2. **Systematic lifting (fallback).** Unknown engines, blocked engines and everything else: extract → analyze →
   lift → platform profile → BGT ([pipeline.md](pipeline.md)).

An engine profile is not a port of the engine to the BGT ABI and never invokes the lifter. The lifting pipeline is
unchanged by it.

## Choice, policy and boundaries

* **The choice is the porter's, recorded in `port/game.json`**: `engineProfile.allowed: true` plus a short
  `engineProfile.choice` reason. The K45 operator-authorization step (trial brief marker / outside policy file) is
  gone (strategy v2, Nov 20 2026); `trial:brief --allow-engine-profile` is accepted and ignored. Build manifests and
  trial records carry `executionPath: engineProfile`, the choice, the runtime id and all hashes.
* `pipeline` and `engineProfile` are mutually exclusive in one `game.json`.
* Game logic and assets are not rewritten. Normalizing an embedded pack to a standalone `game.pck` may change
  **only** offset words (Godot 3: per-file offsets; Godot 4.0–4.2: the file-base word); Godot 4.3+ embedded packs
  are copied byte for byte. Every per-file MD5 is checked before use.
* Runner version/build signatures corroborate identity but can be forged; a custom fork, missing modules or
  platform-specific scripts can still differ. Detection is not a compatibility proof. Browser boot, input-induced
  visible change and no runtime errors are mandatory before **any** level claim.
* No DRM/activation/encryption bypass: encrypted packs, encrypted files/scripts are reported as blockers and never
  decrypted. Possession is not permission to redistribute a game; this kit makes **no redistribution clearance
  claim**. Runtime archives, extracted runtimes, packs and bundles are private/local-only (leakcheck enforces it,
  including renamed copies of pinned runtime files and `GDPC` bytes).
* Godot is MIT-licensed but bundles third-party components: the release tag's `LICENSE.txt` and `COPYRIGHT.txt`
  are hash-pinned per version and copied into every bundle.

## Workflow

    npm run inspect                              # step 1: engines, versions, pack, blockers, recommended path
    npm run engine -- detect                     # the same engine report as JSON (default original/)
    npm run engine -- fetch godot-4.3-nothreads  # official runtime of that exact version -> $BGT_ENGINE_CACHE
    # copy engines.recommendation.profile from reports/inventory.json into port/game.json as "engineProfile"
    npm run build:port                           # deployable static bundle + size metrics
    npm run test:port                            # port tests (served with the bundle's own headers)
    npm run engine -- serve .engine-private/builds/<id>
    npm run engine:probe -- .engine-private/builds/<id> ./explore.mjs

`npm run inspect` prints per engine: version and release commit, runner, pack location and PCK format, the selected
runtime (threaded or not, cross-origin isolation, verification level, cached or the fetch command), requirements,
blockers and warnings, then `RECOMMENDED PATH: engineProfile|pipeline` with the reason. `reports/inventory.json`
gets `engines` with a ready-to-use `recommendation.profile`. Known engines without an adapter (Unity, Unreal,
GameMaker, RPG Maker MV/MZ, Ren'Py) are listed under `otherEngines`; they fall back to lifting and are candidates
for an engine iteration request.

Example `port/game.json` (hash placeholders are not valid hashes):

    {
      "id": "mygame", "name": "My Game", "private": true,
      "engineProfile": {
        "schema": "game-cask/engine-profile/2", "allowed": true,
        "choice": "inspect: Godot 4.3 official build, no blockers; engine runtime is the fast path",
        "adapter": "godot4", "runtime": "godot-4.3-nothreads",
        "version": "4.3", "build": "77dcf97d82cbfe4e4615475fa52ca03da645dbd8",
        "inputRoot": "../original", "runner": "game.exe", "runnerSha256": "<64 hex>",
        "pack": { "location": "embedded-trailer", "sha256": "<64 hex>" },
        "renderer": "webgl2", "threads": false, "width": 1280, "height": 720
      }
    }

`pack.location`: `embedded-trailer` (appended, final 12-byte `GDPC` trailer), `embedded-section` (PE section named
`pck`), `adjacent` (`pack.from` beside the runner) or `explicit` (`pack.from` elsewhere). `runner`/`pack.from` are
relative to `inputRoot` (relative to the config directory, default `../original`); traversal and symlinks are
refused, and every file under the input root must be in the inspect inventory (native side libraries anywhere
block the build). `pack.sha256` is the **normalized standalone** pack hash; `runnerSha256` the whole runner file.
`threads` must match the runtime variant (`-threads` / `-nothreads`). Schema `game-cask/engine-profile/1` configs
still validate.

## Godot coverage

| engine | versions | pack | web runtimes (official export templates) |
|---|---|---|---|
| Godot 3 (`godot3`) | every stable 3.2 – 3.6.x | PCK format 1 | `webassembly_release.zip` (non-threaded); 3.3+ also `webassembly_threads_release.zip` |
| Godot 4 (`godot4`) | every stable 4.0 – 4.4.x | PCK format 2 (flags: encrypted dir, relative file base; per-file encrypted/removal) | 4.0–4.2: `web_release.zip` (threaded only); 4.3+: `web_nothreads_release.zip` and threaded `web_release.zip` |

Runtime ids are `godot-<version>-<variant>` with Godot's own version naming (`4.3`, not `4.3.0`); `godot-3.5.3` is
an alias of `godot-3.5.3-nothreads`. `npm run engine -- runtimes` lists all 61 with their verification level and
cache state.

**Selection is exact**: the runner's version string (`4.3.stable.official`) and release commit pick the runtime;
the pack header must match major.minor (Godot 3: the exact version). There is **no nearby-version fallback**.
Without a runner only the pack header is known and the profile is blocked (`runner-not-found`). The non-threaded
variant is preferred; the threaded variant is selected when the game creates threads (`Thread.new`) or when only a
threaded build exists (4.0–4.2), or explicitly (`npm run engine -- select 4.3 --threads`).

**Shell**: the generated `index.html` uses the engine's JS API of that version: `new Engine(config).startGame()`
(3.3+ and 4.x) or the 3.2 API (`new Engine(); setCanvas(); startGame(executable, pack)`). It never registers the
template's service worker (Godot 4's `ensureCrossOriginIsolationHeaders` is off: the server sends the headers).
Threaded shells fail loudly when the page is not cross-origin isolated.

**Blockers** (fail-closed, structural): `native-extension/GDNative` / `native-extension/GDExtension` (`.dll/.so/
.dylib/.gdnlib/.gdns/.gdextension`, `extension_list.cfg`, GDNative singletons; the Direct3D 12/DXIL/ANGLE DLLs of
official 4.x Windows exports are not extensions), `Mono/C#` (`.cs`/`.csproj`/`.sln`, `res://*.cs` script references,
CLR assemblies, `GodotSharp`/`GodotPlugins`/Mono runtime DLLs, assemblies in `data_*` dirs, `data_*/Assemblies|Mono/`,
`.mono/`, the `C#` feature or assembly-name settings, and a `.mono.` runner version signature — never symbol strings
such as `GodotSharp`, which every official build contains), `encrypted-pack`, `encrypted-content`, `encrypted-script`,
`patch-pack` (4.4 removal entries), `additional-packs`, `platform-code/OS.execute`, runner `custom_build`/prerelease/
unknown build, `no-official-web-runtime-for-version`, `threads-required-but-no-threaded-web-runtime` (3.2),
`runtime-version-mismatch`, `uninspected-files`. **Requirements/warnings** (never block): thread use (selects the
threaded runtime), `WorkerThreadPool`, non-`gl_compatibility` 4.x renderers (web renders GL Compatibility), GLES2
projects, compiled GDScript (not scanned), and always `feature-scan-incomplete`. Text resources are scanned in
bounded overlapping chunks across the entire resource; text heuristics are supplementary, not an inventory.
Inputs are bounded to 2 GiB and 100,000 pack entries.

## Official runtimes: download, verification, cache

`tools/engine/runtimes.json` is generated from the official release host by the maintainer tool
`GITHUB_TOKEN=… node tools/engine/godot-releases.mjs --write` (github.com/godotengine/godot-builds releases and the
godotengine/godot tags). Per release it pins the export-template archive URL and size, the **published SHA-512**
from the release's `SHA512-SUMS.txt` (null where none is published: 3.2–3.5.2, 4.0.x, 4.1, 4.1.1), the web template
members' names, sizes and CRC32 (read from the archive's central directory with HTTP range requests), the release
commit and the notices' SHA-256.

`npm run engine -- fetch ID` caches a runtime **outside the repository** in `$BGT_ENGINE_CACHE` (default
`~/.cache/game-cask/engine-runtimes`; never committed). Verification levels, recorded in the cache receipt, the
build manifest and the inspect report:

| level | how | cost |
|---|---|---|
| `pinned-member-sha256` | the web template ZIP's SHA-256 is pinned in the manifest (only ever pinned from a full archive verified against the published SHA-512, or reviewer-supplied and since confirmed so); only that member is range-fetched | ~5–10 MB |
| `published-archive-sha512` | no member pin yet: the whole archive is downloaded and checked against the published SHA-512 (`--full` forces this) | 0.5–1.3 GB, deleted after extraction unless `--keep-archive` |
| `manifest-crc32` = **unverified** | the release publishes no checksum: only the pinned CRC32/size and TLS from the official host. Refused unless `--allow-unpublished` at fetch time **and** `engineProfile.allowUnverifiedRuntime: true` recorded in game.json at build/serve time; the build report says UNVERIFIED | ~5–10 MB |

Pinned members today: 3.5.3, 4.3 and 4.4.1 (both variants each). After a `published-archive-sha512` fetch, a
maintainer may run `npm run engine -- pin ID` to pin that member (the review is the commit of runtimes.json).
Offline: `npm run engine -- fetch ID --from Godot_v…_export_templates.tpz` (verifies the published SHA-512;
`LICENSE.txt`/`COPYRIGHT.txt` beside it or fetched from the tag) or the K45 form
`npm run engine:provision -- ID web_template.zip NOTICES_DIR` for pinned members. Every member ZIP is validated
entry by entry (paths, links/special files, encryption, sizes) before extraction, every member is CRC32 checked,
and every later build re-verifies the cached files: pinned runtimes against the manifest; unpinned ones by
re-extracting the cached official web template ZIP (kept as `web-template.zip`, checked against the manifest's
CRC32/size pin and the receipt). A receipt can never claim a level the manifest entry does not allow. The bundle is
written from bytes re-hashed against those verified hashes. `npm run engine -- doctor ID` re-verifies a cache entry.

## Deployable bundle and metrics

`npm run build:port` writes `.engine-private/builds/<id>/`, a self-contained static site:

* the official runtime files the page loads (`godot.js`, `godot.wasm`, audio worklets, the pthread worker of
  threaded 3.x/4.0–4.2 builds; not the template's HTML, service worker or PWA files), `LICENSE.txt`, `COPYRIGHT.txt`;
* `game.pck` (normalized, unchanged content), `index.html` (generated shell), `browser-adapter.js` (observation
  only: `window.__BGT_TEST__` subset for tests/probes);
* **headers**: `_headers` (Netlify / Cloudflare Pages syntax) and `headers.json` (same content, for other hosts and
  for `npm run engine -- serve`): MIME types (`.wasm` → `application/wasm`, `.pck` → `application/octet-stream`),
  `nosniff`, a same-origin CSP, and for threaded runtimes `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin` (SharedArrayBuffer);
* `manifest.json`: detection, choice, runtime (id, variant, verification, archive pins, file hashes), headers,
  per-file SHA-256 and **metrics**: `downloadBytes` (everything the page may fetch), `downloadGzipBytes` (gzip -9
  estimate), `packBytes`, `runtimeBytes`, `wasmBytes`, `bundleBytes`, per-file sizes. The build prints them.

The local server serves only the manifest's hash-checked files with exactly the bundle's declared headers, binds
127.0.0.1 on `BGT_E2E_PORT` (never 5173), and refuses a threaded bundle without isolation headers. Run untrusted
games only in an isolated browser/host sandbox; localhost/CSP is not an OS security boundary.

## Browser tests and probes

`tests/support/engine-profile.ts` opens a served build, injects trusted Playwright DOM keys, observes RAF intervals
and collects console/page/HTTP/request failures. Install `await collectEngineErrors(page, files)` before navigation
with the runtime's verified hashes (`verifyRuntime(id).files`, which for pinned runtimes are the checked-in
allowlist), then `await capture.finish()` before asserting errors. The engine:probe command uses the normal
`makeProbe` facade.

Godot's loader wraps the original fetch reader in a progress stream, then tees/clones that response; Chromium can
report `net::ERR_ABORTED` at that handoff after receiving the entire wasm. Capture classifies a cancellation as
**canceled-after-complete** only for HTTP 200, EOF observed, Content-Length equal to the received bytes and SHA-256
equal to the verified runtime member, using a per-request capture token (test/probe only; production shells send
none). Partial, early, HTTP-error and wrong-hash responses fail.

**Not supported on this path:** pause, deterministic stepping/seed replay, peek, savestates, command injection,
BGT resource tours, trace oracles, guest coverage and BGT CPU profiling (explicit errors/null). `step(n)` observes n
RAFs; timing is browser display cadence, not engine FPS. BGT backend (WebGPU/WebGL 2) and suspension (Asyncify/
JSPI) selection do not apply: Godot web runtimes render with WebGL 2 (GLES2 projects: WebGL 1).

CC0 fixtures: `tests/fixtures/engine/godot3-fixture.mjs` (PCK 1) and `godot4-fixture.mjs` (PCK 2, absolute or
relative file base, 4.4 path style) write project.binary, a text scene and a GDScript that fills the viewport red
and cyan after Enter, plus a stub runner with an appended pack. `tests/engine/godot-runtimes.spec.ts` boots them on
the real cached runtimes (default 3.5.3, 4.3 and 4.4.1, both variants; `BGT_ENGINE_RUNTIMES=id,id` selects others) and
checks pixels, input, headers/cross-origin isolation, network integrity and timing; a case skips only when its
runtime is not cached. Unit tests never need a runtime or the network.

## Adding another engine adapter

1. Register an adapter in `tools/engine/framework.mjs` and detection in `tools/engine/detect.mjs`: pack
   discovery/parse/hash validation, runner identification, blockers/requirements and shell generation. Consume the
   inspect inventory plus hash-bound read-only inputs; never execute runners.
2. Specify exact engine/build matching, pack locations/normalization and hard bounds. Add CC0 fixtures and negative
   tests for malformed inputs. Avoid game-dependent branches.
3. Pin official runtimes from the official release host (archive size, published checksum, members, notices) with
   a generator like `godot-releases.mjs`; never commit runtime bytes. Define MIME, renderer, worker and
   cross-origin-isolation requirements; never silently substitute releases.
4. Add a browser boot+input test on the real runtime, timing/error evidence, and document unsupported features.
