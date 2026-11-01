# Lane K6c: WASAPI shared-mode initialisation contracts (Q23)

Branch `lane/K6c` on integration commit `ca2cd17`. Engine-agnostic: no game files, overrides or per-game paths.
Evidence for the target came only from the read-only trial measurements (`resume3-llvm-audio.log`, Q23): the
game writes its configured rate into the mix `WAVEFORMATEX` (0x0167be7d..be98), sets only
`AUDCLNT_STREAMFLAGS_RATEADJUST` (0x100000), passes mode 0, periodicity 0 and a 1 s or zero duration.

## Contracts now implemented (`platforms/win32/w32_audio.c`, `w32_com.c/.h`)

| Area | Behaviour (HRESULT) |
|---|---|
| Flags | Valid: CROSSPROCESS, LOOPBACK, EVENTCALLBACK, NOPERSIST, RATEADJUST, SRC_DEFAULT_QUALITY, AUTOCONVERTPCM, SESSIONFLAGS (accepted, no effect). Any other bit: `E_INVALIDARG`. LOOPBACK (shared): `AUDCLNT_E_ENDPOINT_CREATE_FAILED` (no loopback/capture path). |
| Mode | `>1`: `E_INVALIDARG`. Exclusive: `LOOPBACK`/`CROSSPROCESS` -> `E_INVALIDARG`, otherwise `AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED`. |
| Periodicity | Shared mode: non-zero -> `E_INVALIDARG`. |
| Format | NULL `E_POINTER`; malformed (zero channels/rate/bits, bad block align or byte rate, EXTENSIBLE `cbSize<22`, valid bits > bits) `E_INVALIDARG`; unknown tag/sub-format or beyond the converter (>2 channels, odd sample size, rate outside 8-192 kHz) `AUDCLNT_E_UNSUPPORTED_FORMAT`. PCM 8/16/24/32 and float32, mono/stereo, WAVEFORMATEX and EXTENSIBLE. |
| Mix vs convert | The mix format (float32 stereo at the sink rate) needs no flag. A float32 stereo format at another rate needs RATEADJUST or AUTOCONVERTPCM. Anything else needs AUTOCONVERTPCM, otherwise `UNSUPPORTED_FORMAT`. |
| Duration | `0` -> 100 ms; below one 10 ms period -> one period; ceil to whole frames; negative or `> 10 s` -> `AUDCLNT_E_BUFFER_SIZE_ERROR`. Staging buffer and queue live on the guest heap and are freed with the last reference. |
| Periods | `GetDevicePeriod` 10 ms default / 3 ms min; `GetStreamLatency` = one period; buffer is never shorter than the period. |
| IsFormatSupported | Shared: `S_OK` (closest NULL) for the mix, `S_FALSE` + owned mix-format copy for other formats, `E_INVALIDARG` malformed, `UNSUPPORTED_FORMAT` unknown; NULL closest `E_POINTER`; exclusive with a closest pointer `E_INVALIDARG`, else `UNSUPPORTED_FORMAT`. |
| GetService | `IAudioRenderClient`, `IAudioClock`, `IAudioClockAdjustment` (needs RATEADJUST, else `E_INVALIDARG`), `IAudioStreamVolume`, `ISimpleAudioVolume`. One child object per interface and client (repeat requests return the same pointer and AddRef); each child holds the client, so releasing the client first is safe. Unknown IID `E_NOINTERFACE`; before Initialize `AUDCLNT_E_NOT_INITIALIZED`. |
| SetSampleRate | Float argument (xmm1 on Win64, stack on i386), 8000-192000 Hz else `E_INVALIDARG`; settles frames at the old rate, then changes the consumption rate and rescales the phase. Pitch and duration of what is played change accordingly. |
| Resampling | Phase accumulator on the virtual clock; sample hold by default (existing behaviour), linear interpolation for RATEADJUST or SRC_DEFAULT_QUALITY streams. Mono is duplicated, 8/24/32-bit converted top-aligned. |
| IAudioClock | Frequency = format rate; position = sink frames delivered, scaled to that rate (follows SetSampleRate, restarts on Reset); QPC in 100 ns units; characteristics FIXED_FREQ. |
| Volumes | Per-channel stream volume (client channel count) and session master/mute applied when frames reach the sink; streams with the same session GUID (NULL = default) share ISimpleAudioVolume. Levels outside [0,1] or NaN `E_INVALIDARG`. |
| Events | Unchanged: scheduler-owned events, signalled per virtual 10 ms pump. |

## Contract change to an existing fixture

Windows-exact validation rejects a 24 kHz int16 stream without AUTOCONVERTPCM. `examples/x64-audio` pass 2 now
passes AUTOCONVERTPCM and first checks that the flagless call returns `UNSUPPORTED_FORMAT`. Its exact 48,000-frame
sample, amplitude, frequency and duration assertions in `tests/unit/audio-input.test.ts` are unchanged. The
coordinator was told of this decision before it was made.

## New fixture and test

`examples/x64-audio-init` (CC0, Win64, normal pipeline) checks, inside the guest, the exact HRESULTs for every
invalid combination, capacities (1 s, 0, tiny, 10 s, fractional, 44.1 and 24 kHz), GetDevicePeriod/StreamLatency
consistency, COM identity, ref counts, release-order lifetime and a 24-iteration leak loop (8 client slots).
It then renders five segments (40,200 sink frames). `tests/unit/audio-init.test.ts` asserts the stereo samples:
44.1->48 kHz RATEADJUST float with channel volume; 24 kHz int16 with SetSampleRate 24/48/12 kHz (500/1000/250 Hz,
6000/3000/12000 frames, interpolated values present, clock positions); mono 44.1 kHz at 450 Hz duplicated to both
channels; EXTENSIBLE 24-bit at 1:1 (exactly two values); session volume 0.5, mute (all zero) and restore. A
300-frame lifted/interpreted oracle covers the fixture.

## Open limits and INFERRED choices

- INFERRED (the documentation does not pin them down): `ENDPOINT_CREATE_FAILED` for loopback, `EXCLUSIVE_MODE_NOT_ALLOWED`
  for exclusive, `BUFFER_SIZE_ERROR` for out-of-range durations, `E_INVALIDARG` for IAudioClockAdjustment without
  RATEADJUST, the 10 s duration bound, the 8000-192000 SetSampleRate range, clock position semantics.
- RATEADJUST permitting a rate-only mismatch comes from the target's own call pattern; not witnessed on native Windows.
- Not implemented: IMMNotificationClient registration (still `E_NOTIMPL`: Windows AddRefs a guest object, which needs a
  native-to-guest call), IAudioClock2, IAudioSessionControl, capture/loopback, exclusive mode, >2 channels, float64.
- Resampling is not band-limited (no anti-alias filter on decimation).
- Session volume state is dropped when the last stream of a session is released (no persistence).
- Eight client slots and eight sessions remain; Stop on a stopped stream still returns `S_OK`.
- No target run, no physical listening, no Safari/iPhone claim.

## Verification status (for the verifier; WIP, Tier 1 not run)

Run history in this clone (all through the heavy gate):

1. Full-example global setup + `audio-init` + `audio-input`: **7 of 8 passed**. All five `audio-input` tests passed
   with the `x64-audio` sample, amplitude, frequency and duration assertions unchanged. `audio-init` failed at
   guest `FAIL 070`: `AUDCLNT_STREAMFLAGS_CROSSPROCESS` was `0x40` in the profile and fixture fallback, but is
   `0x10000` in Windows and the mingw headers. Fixed since (`SF_CROSSPROCESS 0x10000u`).
2. After that fix (fast config, `audio-init` only): the guest contract part passed; the sample test then failed
   only on a too-strict frequency check (992 vs 1000 Hz in a 3000-frame segment, a partial cycle). The test now
   compares rising-crossing counts within one cycle.
3. Last run (`audio-init.test.ts`, fast config): **2 of 2 passed** (contracts + five sample segments + lifted
   vs interpreted 300-frame oracle for `x64-audio-init`). `audio-input.test.ts` was **not** re-run after the
   `CROSSPROCESS` fix and the later edits, and the ABI.md text changed afterwards (no code effect).

Not run at all: `npm run doctor`, `npm run lint` (ESLint, host GCC and all example check-builds; the new C uses
float and `int64` helpers, so run the host-GCC/clang `-Wall -Wextra -Werror` check), `npm run typecheck`, full
`npm test`, `npm run test:e2e` (including `tests/e2e/audio-input.spec.ts` on both renderers), `npm run leakcheck`,
the 300-frame oracle of every other pipeline example, and any i386 build of the changed profile files (the
profile compiles for both guest widths; only the Win64 fixture exercises the code at run time).

Commands, from the clone root, each prefixed `PATH=/Users/dev/projects/pi-work/harness/shim:$PATH` and with
`BGT_E2E_PORT=5213` for browser runs:

```sh
node tools/build/build.mjs examples/x64-audio-init && node tools/build/build.mjs examples/x64-audio
npx vitest run --config vitest.k6c-fast.config.ts            # audio-init + audio-input, no global rebuild
npm run doctor && npm run lint && npm run typecheck
npm test                                                    # rebuilds every example in global setup (slow)
npm run test:e2e
npm run leakcheck
for id in x64-audio x64-audio-init x64-basics x64-cpp x64-cpprt x64-crt x64-gl x64-gui x64-input x64-memory \
  x64-tls x64-smoke x64-contracts x64-sysdlls x64-threads x64-handles x86-handles x86-threads win32-hello \
  x64-scale; do npm run oracle -- examples/$id 300; done   # compare with the I3 list in integration-i3.md
```

Notes for the verifier:

- `vitest.k6c-fast.config.ts` (untracked, listed in `.git/info/exclude`) only skips the global rebuild. **Delete it
  before the final commit.**
- `x64-smoke` includes `examples/x64-audio/audio.c`, so its audio stage now uses `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`
  for the 24 kHz pass; check `tests/unit/x64-smoke.test.ts` and the e2e smoke run.
- Docs that still quote the old limits: `docs/v03-status.md` ("19,200-frame source ring") and
  `docs/handoff/audio-input.md`. `bgt/abi/ABI.md` was updated here; adjust the status line at final integration.
- Remaining finish-line items: Tier 1 gates above; re-run `audio-input` after the fix; amend the handoff with real
  counts; delete the fast config; replace the WIP commit messages.
