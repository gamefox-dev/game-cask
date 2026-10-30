---
name: inspect-game
description: First step of "Port this game" — inventory and classify the files in original/ (executables, assets, platform, confidence) with read-only deterministic tools. Use before any analysis or implementation.
---

# Inspect the game

Goal: a factual inventory with confidence levels. No execution of game code, no guessing presented as fact.

## Steps

1. Run `npm run inspect`. It writes `reports/inventory.json` and prints a summary. It is read-only,
   doesn't follow symlinks, and tolerates an empty `original/`.
   - Empty `original/`: stop. Ask the user to copy their legally obtained game files there.
     Record the trial as `blocked: no user game provided`.
2. Read `original/PROVENANCE.txt` and any README the user placed there. Record any **POLICY**
   (e.g. binary-only) in `reports/progress.json` → `constraints`, and follow it for the whole port.
3. For each executable candidate, note:
   - **format/platform**: `mz` (DOS EXE), `dos-com` (flat 16-bit image at 0x100), `le/lx` (DOS extender),
     `pe` (Windows; imports list DLLs), `ne` (Win16), `elf`, ROM headers
   - **hints**: interrupt call-site census (`int 10h` video, `16h` keyboard, `21h` DOS, `33h` mouse,
     `15h` system/joystick), 0x66-prefix density (386 code in 16-bit), port I/O opcodes (direct hardware)
   - **entropy**: > 7.5 suggests compressed or packed data (e.g. an executable packer). Look for unpack stubs
     before disassembling.
4. Strings, for your eyes only: `npm run inspect -- --strings original/<file>`: ASCII and UTF-16LE strings, plus the
   decoded text of PE STRINGTABLE, MENU and DIALOG resources (with control classes and style bits). They go to stdout
   and are never written to reports. Quote only short, necessary strings in `analysis.md`.
5. Installers and archives: `npm run extract -- original/<file> <scratch dir>`. This is static and never executes
   anything. It unpacks zip, RCDATA-embedded PEs (bundlers/wrappers) and Inno Setup 5.x, verifies the installer's own
   SHA-1s, and names payload files from their PE metadata. It writes `extract.json` with the chain of each file.
   Treat the contents as untrusted. Inventory them with
   `node tools/inspect/inspect.mjs <dir> --out reports/inventory-extracted.json`. In `game.json`, refer to them as
   `"installer.exe#NAME.EXE"`. The build re-extracts them reproducibly.
   Unsupported formats (other installers, Inno 6, encryption) are kit gaps: record them.
6. Executables: `npm run analyze -- <file>` (JSON) and `npm run analyze -- <file> --disasm [--func HEX]`
   (listing). See the `use-rea` skill.
7. Summarize in `reports/analysis.md` §Inventory:
   - which file is the game
   - platform/engine assumptions, each with **confidence** and **evidence** (byte offsets, header fields, census counts)
   - what is unknown

## Don'ts
- Don't run the binary on the host. Don't fetch the game or its source from the internet unless the user
  explicitly allows it and no POLICY forbids it.
- Don't paste hex dumps longer than ~16 lines into reports (the report tool flags it).
