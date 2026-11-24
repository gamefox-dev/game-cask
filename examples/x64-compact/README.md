# x64-compact (CC0)

The `x64-cpprt` STL/CRT conformance program (same source, `../x64-cpprt/cpprt.cpp`) built with every K72 size
option: fast lifting with `liftFast.sync: "minimal"` (spill only dirty registers, reload only live volatiles),
`liftFast.calls: "outlined"` (call protocol in `xf_enter`/`xf_leave`), `liftFast.inline: "16"`, and
`pipeline.wasmNames: "strip"` (artifacts without the name section; `game*.wasm.names.json` symbol maps beside them).
Dual build, so both suspension modes run it. The browser spec (`tests/e2e/crt.spec.ts`) compares its output with
the native build of the same source. Measurements: `docs/handoff/K72.md`.
