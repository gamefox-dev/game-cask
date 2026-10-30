# System text substitute font

`font5x7.c` is original Game Cask artwork, dedicated to the public domain under CC0-1.0 (as stated in its header).
The Win32 atlas in `w32_gdi.c` adds original CC0 descenders for g/j/p/q/y to that artwork, in a 6×13 cell, baseline
at row 9, with three descent rows. No Windows font files or other downloaded assets were used.

This is a **substitute**, not an assertion of pixel parity with any proprietary system font. Logical font height
selects the scaled cell (5–256 px); negative height specifies character height plus two pixels of internal leading.
Weights below 700 select regular, 700+ select a one-pixel emboldened face. Metrics, extents, TextOut and DrawText
share the cell's advance/ascent/descent. Dialog font point size uses 96 DPI; DLU uses that face's average advance
and height. Face names are accepted but map to this one openly licensed family. Non-ASCII remains '?' in the
profile's existing string conversion. Italic, kerning and arbitrary installed faces are not implemented.
