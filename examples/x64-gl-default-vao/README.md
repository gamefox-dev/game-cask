# Windows core default element buffer (CC0-1.0)

Original engine-independent Win64 C fixture, normal -O2 pipeline, no BGT imports or overrides.
Reproduces the Q57 API state sequence, not any game data or shader:

- Upgrade WGL context to 3.3 **core**, flags 2.
- VAO0: EBO7 null 131072-byte DYNAMIC_DRAW allocation; unbind. UBO8 80 bytes;
  VBO9 null 262144-byte DYNAMIC_DRAW allocation; unbind.
- VAO0: bind EBO10, upload **49152 bytes** of original CC0 indices STATIC_DRAW, unbind.
- VAO14..18: each binds VBO9/EBO10, sets attributes, unbinds to VAO0. Checks that
  named VAOs do not overwrite VAO0's element binding.
- Supplemental SubData, whole map/unmap, explicit range flush (then host changes
  deliberately NOT flushed), invalidation/unsynchronized range upload under VAO0.
- Five real VAOs draw five index ranges: exact red/green/blue/cyan/yellow pixels.
- Real generated transform-feedback words read through mapping; odd-byte flush
  must preserve native neighbours, not copy a stale upload shadow.

VAO0 attribute setup and draws deliberately retain GL_INVALID_OPERATION. This is the
reviewer-approved evidence boundary, not a claim that every Windows vendor treats
those calls alike. Binds/uploads use the existing approximation metric: **14 calls,
5 unique kinds, one diagnostic each**. Context-global buffer targets do not incur
VAO leniency metrics because they are already valid without a VAO.

Browser tests require every guest check and exact native/presented pixels on WebGL2
and WebGPU. The recording unit test asserts exact expected GPU-dependent failures
(5 pixels + 2 native-feedback checks), never claims to compute/rasterize them.
