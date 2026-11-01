# K8c — WASAPI endpoint notifications (Q23), DOS path prefixes (Q24)

Based on `0838b00`; implementation `67ce229`, fixture boundary correction `82cfceb`. Kit development only: no game files, copied trial measurements,
engine-specific behavior, GL edits, installs, test weakening or pushes. Trial iteration requests and named runtime
logs were read outside the repository; target execution/playability is not claimed.

## Contracts

### Endpoint ownership

`IMMDeviceEnumerator` slots 6/7 now register/unregister guest `IMMNotificationClient` pointers. One process-local
64-entry pool records enumerator/client pairs. Register validates readable object/vtable spans and eight executable
guest method pointers before mutation; NULL/inaccessible callbacks return `E_POINTER`. Each new pair calls guest
IUnknown::AddRef through the guest callback ABI; duplicate pairs return `S_OK` without another AddRef. Missing
unregister returns `E_NOTFOUND` (`0x80070490`), NULL returns `E_POINTER`; full pool returns `E_OUTOFMEMORY` without
acquiring a reference. Unregister clears its pair before guest Release. Enumerators own independent registrations;
final enumerator Release drains its registrations. Its COM table slot is retired before guest callbacks, and the
old guest allocation stays live until callbacks finish, so reentrant creation cannot overwrite/free the new object.

Duplicate idempotence and per-enumerator destruction cleanup are **INFERRED**, explicitly reviewer-approved (no
native Windows parity execution). The model has a fixed render endpoint: registration and stream Start/Stop do
not change device/default-role state, so no OnDevice*/OnDefaultDeviceChanged/OnPropertyValueChanged callbacks are
fabricated. Only guest ownership methods are invoked in this topology. No general COM marshaling/hotplug/capture.

`examples/x64-audio/notifications.h` is original CC0 guest C, normally CRT-linked at -O2. It checks invalid/NULL/
full-width pointers and invalid vtables, duplicates, missing pairs, independent enumerators, caller-first Release,
64-entry exhaustion, recycling, 80 destruction/reuse iterations, reentrant creation/registration during Release,
new-object QueryInterface/identity/refcount survival, and recursive unregister observing the already-removed pair.
A listener remains registered throughout the event-driven audio worker's tone stream, with balanced references
and zero unsolicited notifications checked after rendering. This source also feeds the ten-second smoke fixture.

### Nonzero audio diagnosis

No audio-pump behavior was changed: the existing normal-CRT event-driven worker already generates stereo output.
The strengthened headless test verifies **every** generated tone frame, not merely extrema: 48,000 sink frames /
96,000 int16 samples, exact 1 kHz square-wave phase/amplitude (left +/-16384, right opposite at half amplitude),
float32 and 24 kHz PCM conversion, frequency/duration, two independent event-waiter wakeups and audio-thread join.
The browser test retains a real unlock gesture and requires playedFrames > 0 plus notification ownership markers.
Headless samples establish nonzero output; browser routing is not a physical listening/fidelity claim. The trial's
zero submitted samples/locked playedFrames cannot be attributed to registration alone, and target nonzero output
still requires a resumed target run once its independent graphics/startup blockers are repaired.

### Shared DOS namespace resolution

`w32_fs.h` recognizes absolute `\\?\C:\...` and filesystem `\\.\C:\...` before wildcard/colon checks. Both
kernel32 and CRT use the same keys as ordinary absolute, drive-relative, root-relative and relative DOS paths.
CreateFile now validates through the shared open check rather than treating every failed asset open as error 2.
Stat/attributes/find, mkdir/rmdir, read-only kernel opens, existing CRT FILE opens/descriptors, rename/delete,
cwd and fullpath agree.
Existing root/directory errors remain 183/EEXIST; nested creation requires parents (3/ENOENT), not automatic chains.
Fullpath retains typed component case. Fullpath error propagation now preserves unsupported namespace failures.

Ordinary/extended UNC, including forward/mixed leading separators, fail offline with error 53 (`ERROR_BAD_NETPATH`)
and CRT ENOENT. Unsupported pipe/PhysicalDrive/GLOBALROOT/volume-GUID devices and malformed/relative extended
names return error 123 (`ERROR_INVALID_NAME`), CRT EINVAL. Stat retains its existing all-lookup-failures ENOENT
mapping. These offline/unsupported namespace error selections are **INFERRED**, explicitly reviewer-approved.
No unsupported namespace falls back to a local asset. This is bounded DOS normalization, **not** full NT verbatim
dot/space, long-path or device semantics. Existing ASCII, one-volume root alias, MAX_PATH and process-memory write
limits remain. Kernel writes remain read-only; i386 still has no CRT FILE layer.

`tests/fixtures/c/crt_fs_prefix.h` extends the original normal-CRT filesystem fixture in both widths/modes: seven
path bases, existing/missing parents, stat layouts/attributes, kernel/CRT find, CreateFile reads, AMD64 descriptor/
FILE reads and named writes, rename/remove, cwd/fullpath, typed lowercase root case, wildcard and unsupported
namespace errors. The section marker only says PASS if it added no failures; the overall fixture rejects all FAILs.

## Independent review

Two genuinely fresh read-only local pi sessions ran (PI_BRIDGE=0, no fork). First static review found **R1**:
the new lowercase-root fixture expected uppercase fullpath, contradicting the existing typed-case contract.
Fixed by asserting the exact lowercase component result, not by weakening comparison or changing the resolver;
also made the prefix section PASS marker conditional. The second session returned **bounded static PASS**, with
nonblocking **N1**: unregister/final Release alone would not prove new COM metadata survived reentrant destruction.
Added S_OK QueryInterface, identical IUnknown identity and exact acquired-reference Release checks afterward.
Reviewers ran no tests and are credited only with static inspection; runtime evidence below belongs to this session.
Reports/snapshots: `/Users/dev/projects/pi-work/scratch-K8c/{independent,recheck}/review.md` and associated session
JSONL/snapshots. No independent runtime, native Windows, hardware/mobile or target validation is claimed.

## Verification

Unchanged final implementation, serial gates; ignored evidence is in `reports/k8c/`. Initial cold focused/broad
runs are not final acceptance evidence: the audio oracle compared stale lifted/new interpreted fixtures, and overlapping
filesystem publication caused one missing-manifest preflight. The initial wide descriptor probe also exposed
pre-existing unregistered `_open/_wopen`. Reviewer explicitly selected keeping that adjacent family out of scope:
use `_fileno(_wfopen(...))` for descriptor reads/close, retain real FILE path normalization and record the gap below.
No fixture override or success stub was added. Final serial gates use matching builds and no concurrent writer.

| Gate | Actual result |
|---|---|
| Doctor | ready |
| Lint | ESLint, real host GCC tool check and **27/27** example check-builds pass |
| Typecheck / leakcheck / diff check | pass; leakcheck **506 committable files**, rerun after documentation |
| Default `npm test` | **655 passed / 5 failed**, **59 files / 660 tests**; only inherited Q25 sandbox liveness failures |
| Required-WebGPU `npm run test:e2e` | **208 passed / 51 existing skips / 0 failed / 0 flaky**, port **5220** |
| Browser breakdown | WebGL 2 **94/24** passed/skipped; WebGPU **106/26**; auto **8/1**, neither backend unavailable |
| Every pipeline CLI oracle, 300 frames | **23/23**, **6,900 identical frame pairs**, null errors, zero lifted interpretation, empty profile and GL stub lists |
| CRT filesystem, both widths and both modes | i386 **540 checks**, AMD64 **676 checks**, no FAILs, lifted interp_insns=0; both **600-frame** oracles identical and both guests exited |
| Published CRT artifact diagnostic replay | **2/2** pass, independently re-read the emitted **540/676** summaries; temporary runner/config removed |
| Audio | all **6/6** audio/input tests pass including 300-frame audio oracle; exact **48,000 stereo frames / 96,000 samples** with live listener, no unsolicited changes |

Oracle inventory was derived from every example game.json with `pipeline`: win32-conformance, win32-hello;
x64-audio, audio-init, basics, contracts, cpp, cpprt, crt, gl, gl-fbo, glsl, gui, handles, input, memory, scale, smoke,
sysdlls, threads, tls; x86-handles, threads. Four native BGT examples have no differential oracle and are covered
by their builds/browser tests, not counted as self-oracles. `oracles-summary.json` validates every result.

The inherited Q25 sandbox restriction denies ps and fails five pi-harness FIFO/liveness cases. Reviewer directed
**no** K7i cherry-pick/out-of-lane harness edits: K7i is already on integration and meets this lane in I6. The local
default suite is **not green**, and no test was skipped or weakened. Default npm test is repeated after the final
commit. Exact-final-commit external `tests/unit/pi-harness.test.ts` evidence is recorded separately in ignored
`reports/k8c/external-harness.json` (operator-run, not local/delegated test credit); a missing/mismatched external
record leaves that environment gate open. Reviewer explicitly requires only that sandbox-dependent file externally,
not a replacement external full suite. Do not infer Tier 1-green solely from the local 655 passing tests.

## Remaining boundaries

- No target startup/log/save replay or nonzero target audio claim; resume unchanged target after integration.
- `_open/_wopen/_sopen/_creat` descriptor-creation families remain unimplemented generic CRT follow-ups. Reviewer
  verified the target imports none of these, so this is not a target blocker; that import observation is reviewer
  evidence, not a local binary analysis. Q24 tests use existing wide FILE opens plus real `_fileno/_read/_close`.
- No native Windows parity; duplicate/lifetime and unsupported namespace mappings are labelled INFERRED above.
- Notifications execute on guest ABI but runtime fixture is AMD64; both profile widths compile, i386 ownership ABI
  is static-review coverage only. Fixed topology has no On* transition delivery to exercise.
- Full NT namespace/verbatim/long-path semantics, UNC transport, persistence, general devices, capture, hotplug,
  physical audibility and unrestricted Windows compatibility are not implemented by this lane.
