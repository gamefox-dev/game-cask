# Transform feedback contracts (CC0-1.0)

Original engine-independent Win64 `-O2` / CRT pipeline fixture. No BGT imports, game source, captured shaders or
function overrides. Both actual backends must pass all **100 guest checks**, buffer-byte assertions and the final
pixel probes; the cross-backend image is exact (red rectangle on black, no diagonal raster-edge ambiguity).

Coverage: pending/linked INTERLEAVED/SEPARATE declarations, scalar/vector reflection, original clip position and
point size with hygienic builtin names, float/signed/unsigned bytes, ordinary/UBO/texture vertex inputs, range
prefix/suffix preservation, multiple draws/cursors, instancing/divisors, indexed order, complete list/strip primitives,
rasterizer discard, capture plus rasterization, primitives-written queries, failed-link executable/uniform retention,
ES 3.00 vertex-only capture, non-unit-w noperspective raw capture plus rasterization, normalized byte offsets 1/2/3, native UBO role transitions, zero-output draws, alias and
overflow errors, GPU ping-pong, aligned partial updates, then an actual draw from captured GPU data with **no CPU
reupload** of that data. Exact normalized-byte assertions use representable endpoints, avoiding native conversion
rounding as an accidental bit-exact arithmetic promise.

`tests/e2e/gpu-feedback.spec.ts` additionally checks a five-byte input range, malformed native interface replacement
followed by valid capture, injected native begin failure and cleanup, fail-closed generated-buffer recovery followed
by full-upload recovery, and a 1.4M-vertex strip expanding across the one-dimensional compute dispatch limit.

The headless recording oracle never executes shaders/rasterization. Its unit expects exactly **28** GPU-dependent
failures, while asserting transport order, interfaces, errors and query values. Passing recording/oracle results
are not substituted for native GPU output. See ABI §13.11 for explicit limits and loss behavior.
