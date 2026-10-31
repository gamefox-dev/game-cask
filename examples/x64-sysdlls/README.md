# Offline Win64 system DLL conformance (LANE-K1)

Original CC0 source, normal MinGW CRT entry, -O2, no overrides. Calls all 42 target-requested
exports across AVRT, bcrypt, DINPUT8, dwmapi, IMM32, IPHLPAPI, SHLWAPI, WS2_32 and WSOCK32,
plus AvRevertMmThreadCharacteristics for registration lifetime. COM methods exercise discovery,
identity/refcounts, formats, acquisition, keyboard/mouse snapshots and injected gamepad state.
Each `CHECK` is checked from the unit harness; a failure logs its name and exits with code 77.
Browser tests assert exact dark/bright green pixel transitions and DirectInput key/mouse values.

```sh
npm run build:examples
npx vitest run tests/unit/sysdlls.test.ts tests/unit/sysdlls-host.test.ts
npm run oracle -- examples/x64-sysdlls 300
# use BGT_E2E_PORT, never the developer server
npx playwright test tests/e2e/sysdlls.spec.ts
```

## Sandbox contract

- AVRT tasks use per-thread owned nonreused handles; priorities weight the cooperative scheduler.
  No hard realtime guarantee is made.
- BCrypt uses real host entropy, never the simulation seed. Only oracle runs inject a test replay tape.
- No desktop compositor or installed IME: composition is false; blur/flush fail with
  DWM_E_COMPOSITIONDISABLED; HIMC is absent, not fabricated.
- No IP adapters/routes/DNS/remote transport. Adapter discovery returns ERROR_NO_DATA (no invented
  buffer size/list); route lookup fails. Sockets retain owned local state, wildcard binding,
  byte-order/address conversion and numeric name resolution. Remote operations return WSA errors.
  A blocking receive/accept without transport fails WSAENETDOWN; nonblocking reports WSAEWOULDBLOCK.
- DirectInput exposes attached keyboard/mouse and up to four browser gamepads. Immediate input only;
  buffered events, force feedback, exclusive hardware and action maps fail, not successful no-ops.
- PathFileExistsW shares immutable profile VFS path lookup. `w32_path_exists` is the integration seam
  for K2's writable files/directories; those are not yet visible in this lane. No host paths are read.

Win64 is the finish-line fixture. Shared implementations carry i386 layouts/stdlib arities where cheap,
but this is not independent comprehensive Win32 conformance or arbitrary Windows compatibility.
