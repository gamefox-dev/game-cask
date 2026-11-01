# Lane K6c: WASAPI shared-mode initialisation contracts (Q23)

Branch `lane/K6c`, based on integration `ca2cd17`. The implementation arrived as WIP `5cebef5`; a fresh pi verifier
session reviewed, repaired and completed the lane. Engine-agnostic: no game files, overrides or per-game paths.
Target evidence was the read-only trial measurements (`resume3-llvm-audio.log`, Q23): the caller changes the mix
format's configured rate, sets RATEADJUST (0x100000), passes shared mode, periodicity zero and 1 s or zero duration.
No target binary was loaded or run during verification.

## Implemented contract (`platforms/win32/w32_audio.c`, `w32_com.c/.h`)

| Area | Behaviour (HRESULT) |
|---|---|
| Flags | Valid: CROSSPROCESS (0x10000), LOOPBACK, EVENTCALLBACK, NOPERSIST, RATEADJUST, AUTOCONVERTPCM, SRC_DEFAULT_QUALITY and SESSIONFLAGS. Unknown bits: `E_INVALIDARG`. LOOPBACK in shared mode: `AUDCLNT_E_ENDPOINT_CREATE_FAILED` (no capture path). Session flags are accepted without persistence/UI effects. |
| Mode | Mode >1: `E_INVALIDARG`. Exclusive LOOPBACK/CROSSPROCESS: `E_INVALIDARG`; other exclusive requests: `AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED`. |
| Periodicity | Shared mode requires zero, including event streams; otherwise `E_INVALIDARG`. |
| Format | NULL: `E_POINTER`. Malformed fields (zero channels/rate/bits, inconsistent alignment/byte rate, short EXTENSIBLE extension, valid bits > container bits, float valid bits != container bits, reserved/wrong-count speaker masks): `E_INVALIDARG`. Unknown tag/sub-format or unconvertible format: `AUDCLNT_E_UNSUPPORTED_FORMAT`. PCM 8/16/24/32 and float32, mono/stereo, 8–192 kHz, WAVEFORMATEX/EXTENSIBLE. EXTENSIBLE masks: unspecified (zero), center mono or front-left/right stereo; other well-formed layouts unsupported. |
| Mix vs convert | The float32 stereo sink-rate mix needs no flag. A rate-only mismatch needs RATEADJUST or AUTOCONVERTPCM. Other formats need AUTOCONVERTPCM. |
| Duration | Zero selects 100 ms; minimum one 10 ms period; ceil to whole source frames. Negative: `AUDCLNT_E_BUFFER_SIZE_ERROR`. **No arbitrary 10 s ceiling**: checked frame/byte representability and guest-heap allocation bound positive durations. Unrepresentable sizes or allocation failure: `E_OUTOFMEMORY`. Staging buffer and stereo queue are allocated once and freed with the client. |
| Periods | GetDevicePeriod: 10 ms default / 3 ms minimum. GetStreamLatency: one default period. |
| IsFormatSupported | Shared: `S_OK` + NULL closest for mix; `S_FALSE` + owned mix-format copy for other convertible layouts; malformed `E_INVALIDARG`, unknown `UNSUPPORTED_FORMAT`. NULL closest: `E_POINTER`. Exclusive with closest: `E_INVALIDARG`; without: `UNSUPPORTED_FORMAT`. |
| GetService / lifetime | IAudioRenderClient, IAudioClock, IAudioClockAdjustment (requires RATEADJUST), IAudioStreamVolume and ISimpleAudioVolume. Repeat requests share child identity and AddRef. Each child holds its parent client; releasing the client first is safe. Before Initialize: `AUDCLNT_E_NOT_INITIALIZED`; unknown IID: `E_NOINTERFACE`. |
| SetSampleRate | FLOAT argument via xmm1 (Win64) or stack (i386); 8000–192000 Hz, finite, else `E_INVALIDARG`. Rounded to whole Hz. Settles playback at the previous rate, rescales phase, then changes consumption rate; sample output changes pitch and duration. |
| Resampling | Virtual-clock phase accumulator. Sample hold by default; linear with RATEADJUST or AUTOCONVERTPCM + SRC_DEFAULT_QUALITY. Standalone SRC_DEFAULT_QUALITY is accepted as an inferred no-op. Mono duplicated; wide integers top-aligned to int16. |
| IAudioClock | Frequency = nominal format rate; position = delivered sink frames scaled to that rate; follows playback-rate changes, resets on Reset. QPC in 100 ns units, FIXED_FREQ characteristic. |
| Volume | Stream per-channel gain and shared-session master/mute applied at drain time. Levels outside [0,1], including NaN: `E_INVALIDARG`. Every nonzero BOOL mute value is true. Same GUID (NULL = default) shares master/mute state. |
| Events | Scheduler-owned event handles and wakeups; signalled per virtual 10 ms pump, no native-to-guest audio callback. |

## Fixture and verifier repairs

`examples/x64-audio-init` is an original CC0 Win64 normal-pipeline fixture. Guest assertions cover RATEADJUST with
1 s buffers at 48/44.1 kHz; zero/tiny/fractional/**11 s** durations; AUTOCONVERTPCM; flags, periodicity and format
failures with exact HRESULTs; EXTENSIBLE masks/valid bits; standalone quality hint; oversized arithmetic (including
INT64_MAX duration), real heap allocation failure and successful retry; period/latency, COM identity/refcounts,
client-first release, and a 24-iteration lifetime loop over all five services (eight client slots).

Five audio segments deliver exactly **40,200 stereo sink frames**. `tests/unit/audio-init.test.ts` asserts actual
amplitudes, channel polarity/gain, frequency, duration, clock position/reset, master volume/mute/restore, plus an
independent output-time reference comparing **every sample** in the interpolated 44.1 kHz, mono, and SetSampleRate
24/48/12 kHz segments. EXTENSIBLE 24-bit 1:1 output has exactly two levels. SetSampleRate changes pitch to
500/1000/250 Hz and segment lengths to 6000/3000/12000 frames. The fixture also has a 300-frame differential oracle.

Verifier changes beyond the WIP:

- Removed the unsupported 10-second ceiling, using overflow-safe seconds/fraction arithmetic and checked UINT32
  frame/byte lengths before allocation. Reviewer explicitly approved representability/heap bounds and E_OUTOFMEMORY.
- Added EXTENSIBLE float valid-bit and speaker-mask validation (reviewer-approved); accepted standalone quality hint
  as a no-op rather than inventing an unsupported Windows failure path (reviewer-approved, INFERRED).
- Fixed BOOL mute handling (the WIP tested only its low byte), with a 0x100 regression case.
- Added every-sample resampling assertions, not merely extrema and approximate crossing counts.
- Fixed the smoke test's host-step/guest-poll assumption. Initial e2e reported pad=99/buttons=99 on all three smoke
  runs: 100 host updates can include a worker-wait continuation without an input sample. The fixture now logs its
  100th sample and waits for disconnect; e2e drives to that acknowledgement, with a bounded timeout. Exact final
  **pad=100/buttons=100**, worker checksum, 6000 draws, cross-backend per-frame hashes and image assertions remain
  unchanged. A reviewer bridge request timed out; its stated default was this deterministic acknowledgement repair.
- Updated stale ABI/status buffering, EXTENSIBLE and scheduler-event documentation. Deleted the untracked fast config.

The earlier approved `x64-audio` pass-2 change remains: its 24 kHz int16 request needs AUTOCONVERTPCM and explicitly
asserts flagless rejection. Existing **48,000-frame** audio-input sample/amplitude/frequency/duration assertions are
unchanged and green; `x64-smoke` includes this source for its ten-second audio worker.

## Verification — final green results

All final broad gates ran serially through the installed machine-wide FIFO npm/npx gate. No implementation or test
edits occurred during the final tier-1 sequence. This fresh session performed the verification; no extra delegated
or native-Windows validation is claimed.

| Gate | Result |
|---|---|
| Focused audio-init + audio-input | **8/8 tests, 2/2 files**, twice: before and after audio repairs |
| Focused smoke after acknowledgement repair | **1/1 unit**, **3/3 browser runs**, including cross-backend |
| `npm run doctor` | ready |
| `CC=clang npm run lint` | ESLint + real host GCC tool check + **25/25** example check-builds |
| Explicit changed-profile compiler checks | clang 21.0.0 + GCC 14.2.0, `-std=c11 -O2 -Wall -Wextra -Werror`, both sparse and flat memory modes; syntax checks and **8 object compilations** pass |
| `npm run typecheck` | pass |
| `npm test` | **575 tests / 53 files passed**, no skips or failures |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **200 passed, 51 existing intentional skips**, zero failures/flaky |
| Browser breakdown | WebGL 2 **91 pass / 24 skipped**; WebGPU **101 / 26**; auto **8 / 1** |
| `npm run leakcheck` | clean, **464 committable files** (rerun after final handoff) |
| Every pipeline oracle, 300 frames | **21/21, 6,300 identical frame pairs**; both errors NULL, lifted interp_insns=0, empty profile/GL stub lists |
| `git diff --check` | clean |

Oracle inventory was derived from **every** `examples/*/game.json` with `pipeline`, not the incomplete WIP command list:
win32-conformance, win32-hello; x64-audio, audio-init, basics, contracts, cpp, cpprt, crt, gl, gui, handles, input,
memory, scale, smoke, sysdlls, threads, tls; x86-handles, threads. Native bench/gpu-readback/gpu-scenes/sample2d have
no interpreted counterpart and are not counted as differential oracles. Explicit CLI oracles ran after both suites.

Ignored evidence: `reports/e2e-results.json`, `reports/k6c-oracles.json`, `reports/oracle-*.json`; external logs at
`/Users/dev/projects/pi-work/scratch-K6c/verify/`: focused/focused2, smoke-unit/smoke-e2e, host-compilers, doctor,
lint, typecheck, test, e2e, leakcheck, oracle-*, oracle-summary and progress logs. `initial/` retains the first broad
run (575 unit passes, 197 browser passes / 3 smoke failures), not counted as the final green browser gate. The WIP's
older 7/8 and 2/2 diagnostic history is superseded by these fresh full-suite results.

## Open limits / INFERRED choices

- No native Windows HRESULT-parity run. INFERRED: unsupported-loopback ENDPOINT_CREATE_FAILED, exclusive-mode error,
  BUFFER_SIZE_ERROR for negative duration, E_INVALIDARG for adjustment service without RATEADJUST, 100 ms zero-duration
  default, 8–192 kHz adjustment range, standalone quality-hint no-op, and clock-position semantics.
- RATEADJUST permitting a rate-only mix-layout mismatch is reviewer-approved from the target call pattern, not native
  Windows evidence. Fractional-Hz SetSampleRate is rounded, not preserved exactly.
- No band-limited filtering/anti-aliasing on decimation. Locked/full browser queues may drop audio. This change does
  not add multi-stream mixing or broaden BGT's existing output/backpressure contract.
- No IMMNotificationClient registration (still E_NOTIMPL), IAudioClock2, IAudioSessionControl, capture/loopback,
  exclusive mode, >2 channels, other speaker layouts or float64.
- Eight client/session slots; session volume disappears after the last stream releases (no persistence); Stop on an
  already stopped stream remains S_OK. Guest heap limits large durations; there is no wall-clock duration ceiling.
- Both profile widths compile; the new audio-init runtime fixture is Win64 only.
- No target run, host execution of original binaries, physical listening, Safari/iPhone or remote-CI claim.
