# Existing-DLL contract fixture (CC0)

`contracts.c` is original source, compiled normally for x86_64-windows-gnu at `-O2` with MinGW CRT startup.
No custom entry point, guest-function override, engine detection or original-game input.

The fixture prints **181 named contract assertions**. It checks real memory-protection/query outputs; contiguous
MinGW FILE layout; descriptors, alias lifetime, stat/seek/read/write/reopen and redirected stdout; secure strings,
UTF-16 time formatting; recursive CRT locks, suspended waits and `_beginthread`; environment, locale/calendar,
monitor callback ABI, Raw Input devices, clipboard, wildcard shipped/streamed/mutable file and directory
enumeration; icon copies/hotspots/destruction; and explicit failure contracts for unavailable facilities.

A 60-frame message loop permits real BGT pointer movement. `WM_MOUSEMOVE` registers client hover/leave; unit and
browser tests wait for `tracking ready`, inject an inside pointer then an outside pointer, and require exactly one
`WM_MOUSEHOVER` and one `WM_MOUSELEAVE`. The differential oracle uses deterministic input rather than these exact
positive-event counts. The final `_amsg_exit` deliberately bypasses an atexit sentinel and exits with runtime code
255; the headless/browser tests require all preceding assertions and no sentinel output.

`assets/nested/{one,two}.txt` and `streamed.txt` are original CC0 enumeration data. The generated VFS index is
private build output derived from manifest assets/streams, not committed measurement data.

Run:

```sh
node tools/build/build.mjs examples/x64-contracts
npm run oracle -- examples/x64-contracts 300
npm test
BGT_E2E_PORT=<owned-port> npm run test:e2e
```

`tests/unit/contracts.test.ts` adds all-name GetProcAddress parity probes for both guest widths and five denied
access cases (guest writes, reads, execution and CRT buffer paths), each in lifted and interpreted execution.
Failures, absence and implementation limits are intentionally distinct from successful emulation; see
[`platforms/win32/CONTRACTS.md`](../../platforms/win32/CONTRACTS.md).
