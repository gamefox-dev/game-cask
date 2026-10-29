---
name: recover-assets
description: Recover graphics, palettes, fonts, levels and sound from original game files (or data embedded in the executable) into BGT-loadable assets, keeping provenance and keeping them private.
---

# Recover assets

Original assets stay private: generated assets go to `port/assets/` (git-ignored) and are served from
`web/public/games/<id>/assets/` after `npm run build:port`.

## Approach
1. Find the data: separate files (inventory formats) or tables inside the executable (look for palette-like
   runs of 768 bytes with values ≤ 63 (6-bit VGA DAC), bitmap fonts (8 bytes/glyph), sprite tables, level grids).
   Record the offset, size and evidence for each.
2. Decode with deterministic scripts. Never "redraw" assets by hand unless the subsystem strategy says
   `replace`, and label replacements as such in `known_deviations`.
3. Convert to BGT formats:
   - images → BGTI via `node tools/assets/convert.mjs bmp|pcx|raw8|pal IN OUT [...]`.
     Load in C with `bgt/include/bgt_image.h` (`bgt_image_parse`), upload with `bgt_cmd_tex_create/update`.
   - indexed framebuffers (e.g. VGA mode 13h, 320×200×8): keep the indexed buffer in C, convert to RGBA through
     the palette each frame (or on change), upload as one texture, draw one sprite. This is usually the most
     faithful approach for DOS games.
   - sound: render to int16 mono at `io.audio_sample_rate` and `bgt_audio_push`. Model PC-speaker/PIT square
     waves from the recovered divisor (`1193182 / divisor` Hz).
4. Wire assets into `port/game.json` via `"assets": "assets"`. Every asset is hashed into the manifest.
5. Verify: a test or screenshot shows the asset rendered correctly (palette right, not transposed or mirrored).
   Note the check in `subsystem-map.json` → `verification_evidence`.

## Embedding vs. files
If the port must read the original executable itself (e.g. `selective-emulate` of a code image), place it in
`port/assets/` via a build step that **copies from `original/` at build time**. Never commit it. `npm run leakcheck`
will flag any copy that reaches a committable path.
