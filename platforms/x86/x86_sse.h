/* Shared scalar SSE conversion primitives. MIT.
 * Integer bit rounding avoids host fenv dependencies and int64->double->float double rounding.
 * FP traps, DAZ/FTZ and arithmetic exception delivery retain the documented runtime boundary. */
#ifndef X86_SSE_H
#define X86_SSE_H
#include <stdint.h>
static inline double xs_nearest_even(double x) {
    if (!(x < 4503599627370496.0 && x > -4503599627370496.0)) return x;
    double lo = __builtin_floor(x), d = x - lo;
    return d < 0.5 ? lo : d > 0.5 ? lo + 1 : ((int64_t)lo & 1) ? lo + 1 : lo;
}
static inline int64_t xs_to_int(double x, int bits, int truncating, uint32_t mxcsr) {
    unsigned mode = truncating ? 3 : (mxcsr >> 13) & 3;
    x = mode == 0 ? xs_nearest_even(x) : mode == 1 ? __builtin_floor(x) :
        mode == 2 ? __builtin_ceil(x) : __builtin_trunc(x);
    double lo = bits == 64 ? -9223372036854775808.0 : -2147483648.0;
    double hi = bits == 64 ? 9223372036854775808.0 : 2147483648.0;
    if (!(x >= lo && x < hi)) return bits == 64 ? INT64_MIN : INT32_MIN;
    return (int64_t)x;
}
/* Pack exact magnitude * 2^power into binary32/64 with the guest RC. */
static inline uint64_t xs_pack(uint64_t mag, int power, unsigned sign, int frac, int bias, uint32_t mxcsr) {
    uint64_t signbit = (uint64_t)sign << (frac + (frac == 23 ? 8 : 11));
    if (!mag) return signbit;
    int e = 63 - __builtin_clzll(mag) + power;
    int quantum = e - frac, minimum = 1 - bias - frac;
    if (quantum < minimum) quantum = minimum;
    int shift = quantum - power;
    uint64_t q, rem = 0, half = 0;
    if (shift <= 0) q = mag << -shift;
    else if (shift < 64) { q = mag >> shift; rem = mag & ((1ull << shift) - 1); half = 1ull << (shift - 1); }
    else { q = 0; rem = mag; if (shift == 64) half = 1ull << 63; }
    unsigned mode = (mxcsr >> 13) & 3;
    if (rem && ((mode == 0 && half && (rem > half || (rem == half && (q & 1)))) ||
        (mode == 1 && sign) || (mode == 2 && !sign))) q++;
    if (q >= (2ull << frac)) { q >>= 1; quantum++; }
    if (q < (1ull << frac)) return signbit | q;
    e = quantum + frac;
    if (e > bias) {
        uint64_t inf = (uint64_t)(2 * bias + 1) << frac;
        int infinity = mode == 0 || (mode == 1 && sign) || (mode == 2 && !sign);
        return signbit | (infinity ? inf : inf - 1);
    }
    return signbit | ((uint64_t)(e + bias) << frac) | (q & ((1ull << frac) - 1));
}
static inline uint64_t xs_from_int(int64_t value, int dbl, uint32_t mxcsr) {
    unsigned sign = value < 0;
    uint64_t mag = sign ? 0ull - (uint64_t)value : (uint64_t)value;
    return xs_pack(mag, 0, sign, dbl ? 52 : 23, dbl ? 1023 : 127, mxcsr);
}
static inline uint32_t xs_double_to_float(uint64_t bits, uint32_t mxcsr) {
    unsigned sign = (unsigned)(bits >> 63), exponent = (unsigned)(bits >> 52) & 2047;
    uint64_t mantissa = bits & 0xfffffffffffffull;
    if (exponent == 2047) return (sign << 31) | 0x7f800000u |
        (mantissa ? (uint32_t)(mantissa >> 29) | 0x400000u : 0);
    return (uint32_t)xs_pack(mantissa | (exponent ? 1ull << 52 : 0),
        exponent ? (int)exponent - 1023 - 52 : -1074, sign, 23, 127, mxcsr);
}
#endif
