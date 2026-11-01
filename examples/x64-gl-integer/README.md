# Integer GL contracts (CC0)

Normal -O2 Win64/CRT pipeline fixture, no BGT imports or overrides. It exercises all 18 R/RG/RGBA 8/16/32-bit signed
and unsigned formats: allocation, saturated integer pixel conversion, full-width GetTexImage, nonzero-unit integer
samplers with repeat wrapping, texture/LOD/gradient/fetch, typed swizzles including ZERO/ONE, integer render targets,
ignored blending, exact ReadPixels and post-render GetTexImage, and transfer-class errors. There are **198** asserted
guest checks. All full-width values pass as integers, not float-normalized values.

The recording oracle validates transport/control/storage, not rasterization. Its 72 raster-dependent checks must
fail; both actual browser backends must pass all 198 checks. Two extra observations pin a named native boundary:
out-of-range integer fragment outputs into R8 targets have no portable GL result. This machine's WebGL returns 0
for unsigned 0xfedcba98 and 1 for signed -2147483647; WebGPU saturates to 255/-128. They are explicitly excluded from
cross-backend equality; no normalization is hidden. Integer sampling is currently 2D only.
