---
name: use-rea
description: Detect and use REA (reverse-engineering assistant) via MCP/CLI when — and only when — it is actually available; otherwise document how to connect it and continue with deterministic local tools (disassemblers, scripted decoders).
---

# REA and analysis tooling

## 1. Detect (never assume)
- `reports/inventory.json` → `tools.rea` reports what `npm run inspect` found: a `.mcp.json` server whose name
  contains `rea`, a `REA_MCP_URL` env var, or a `rea` CLI on PATH.
- Also check your **own tool list in this session** for `mcp__rea__*` (or similarly named) tools.
- REA counts as available only if a trivial call succeeds (e.g. listing its tools or loading the binary).
  Record the call and its result in `reports/analysis.md`.

## 2. If REA is available
- Load the candidate executable read-only and ask for: entry point, function boundaries, call graph,
  interrupt/IO usage, strings with cross-references, data tables.
- Cross-check every important claim with a second method (e.g. a disassembler or byte offsets) before using it
  in the port. Record `source_evidence` as `"rea: <query> -> <finding>"`.

## 3. If REA is NOT available (say so explicitly)
Write in `reports/analysis.md`: "REA not available in this session; analysis used: …".
Then tell the user how to connect it:
```sh
# example: register an MCP server named "rea" for this project (adjust command to your REA install)
claude mcp add rea -- <rea-mcp-server-command> [args]
# or set REA_MCP_URL / put `rea` on PATH, then re-run: npm run inspect
```
Continue with deterministic tools:

| need | tool |
|---|---|
| x86 16/32-bit disassembly | `ndisasm` (`brew install nasm` / `apt install nasm`): `ndisasm -b 16 -o 0x100 FILE.COM` for .COM. `objdump -D -b binary -m i8086` (GNU binutils; Apple's llvm `objdump` cannot read raw binaries) |
| interactive RE | radare2/rizin (`r2 -a x86 -b 16 -m 0x100 FILE.COM`), Ghidra headless (`analyzeHeadless`) |
| your own decoders | small Python (`python3 -I`) or Node scripts that parse headers, tables and formats. Keep them in the scratchpad or `port/tools/`, never inside `original/` |
| strings | `npm run inspect -- --strings FILE` |

Installing a tool is a system change: ask the user first, or use one already present
(`tools.local` in the inventory lists what was found).

## 4. Evidence discipline
- Every recovered rule cites where it came from: address/offset, instruction sequence (≤ 10 lines quoted),
  table location, or observed behaviour.
- A behaviour you could not find in the binary is `INFERRED`. Say what it was inferred from.
- Never write "REA confirmed …" unless REA was actually called in this session.
