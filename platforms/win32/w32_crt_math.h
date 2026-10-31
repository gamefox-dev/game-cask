/* IEEE binary32/binary64 operations from Zig's bundled musl, not approximations. MIT bridge. */
#define MATH_UNARY(name) \
    static uint64_t c_##name(void) { return rd(name(cd(0))); } \
    static uint64_t c_##name##f(void) { return rf(name##f(cf(0))); }
#define MATH_BINARY(name) \
    static uint64_t c_##name(void) { return rd(name(cd(0), cd(1))); } \
    static uint64_t c_##name##f(void) { return rf(name##f(cf(0), cf(1))); }
MATH_UNARY(fabs)
MATH_UNARY(round)
MATH_UNARY(floor)
MATH_UNARY(ceil)
MATH_UNARY(trunc)
MATH_UNARY(nearbyint)
MATH_UNARY(rint)
MATH_UNARY(sqrt)
MATH_UNARY(cbrt)
MATH_UNARY(exp)
MATH_UNARY(exp2)
MATH_UNARY(expm1)
MATH_UNARY(log)
MATH_UNARY(log2)
MATH_UNARY(log10)
MATH_UNARY(log1p)
MATH_UNARY(sin)
MATH_UNARY(cos)
MATH_UNARY(tan)
MATH_UNARY(asin)
MATH_UNARY(acos)
MATH_UNARY(atan)
MATH_UNARY(sinh)
MATH_UNARY(cosh)
MATH_UNARY(tanh)
MATH_UNARY(asinh)
MATH_UNARY(acosh)
MATH_UNARY(atanh)
MATH_UNARY(erf)
MATH_UNARY(erfc)
MATH_UNARY(tgamma)
MATH_UNARY(lgamma)
MATH_BINARY(fmod)
MATH_BINARY(remainder)
MATH_BINARY(pow)
MATH_BINARY(atan2)
MATH_BINARY(hypot)
MATH_BINARY(copysign)
MATH_BINARY(fmin)
MATH_BINARY(fmax)
MATH_BINARY(fdim)
MATH_BINARY(nextafter)
#undef MATH_UNARY
#undef MATH_BINARY
#define MATH_INT(name, type) \
    static uint64_t c_##name(void) { return (uint64_t)(type)name(cd(0)); } \
    static uint64_t c_##name##f(void) { return (uint64_t)(type)name##f(cf(0)); }
MATH_INT(llround, int64_t)
MATH_INT(lround, int32_t)
MATH_INT(llrint, int64_t)
MATH_INT(lrint, int32_t)
#undef MATH_INT
static uint64_t c_ldexp(void) { return rd(ldexp(cd(0), (int32_t)ARG(1))); }
static uint64_t c_ldexpf(void) { return rf(ldexpf(cf(0), (int32_t)ARG(1))); }
static uint64_t c_frexp(void) {
    int e;
    double r = frexp(cd(0), &e);
    x86_wr32(ARG(1), (uint32_t)e);
    return rd(r);
}
static uint64_t c_frexpf(void) {
    int e;
    float r = frexpf(cf(0), &e);
    x86_wr32(ARG(1), (uint32_t)e);
    return rf(r);
}
static uint64_t c_modf(void) {
    double i, r = modf(cd(0), &i);
    memcpy(cwmem(ARG(1), 8), &i, 8);
    return rd(r);
}
static uint64_t c_modff(void) {
    float i, r = modff(cf(0), &i);
    memcpy(cwmem(ARG(1), 4), &i, 4);
    return rf(r);
}
static int win_class(double d) {
    if (isnan(d)) return 0x100;
    if (isinf(d)) return 0x500;
    if (d == 0) return 0x4000;
    return fabs(d) < DBL_MIN ? 0x4400 : 0x400;
}
static uint64_t c_fpclassify(void) { return (uint64_t)win_class(cd(0)); }
static uint64_t c_fpclassifyf(void) {
    float f = cf(0);
    return f != 0 && fabsf(f) < FLT_MIN ? 0x4400 : (uint64_t)win_class(f);
}
static uint64_t c_isnan(void) { return isnan(cd(0)); }
static uint64_t c_isnanf(void) { return isnan(cf(0)); }
static uint64_t c_finite(void) { return isfinite(cd(0)); }
static uint64_t c_finitef(void) { return isfinite(cf(0)); }
static uint64_t c_signbit(void) { return signbit(cd(0)); }
static uint64_t c_signbitf(void) { return signbit(cf(0)); }
static uint64_t c_fpreset(void) { X.mxcsr = 0x1f80; return 0; }
static uint32_t control_word(uint32_t value, uint32_t mask) {
    static const uint32_t em[6] = {0x10, 0x80000, 8, 4, 2, 1};
    uint32_t old = (X.mxcsr >> 5) & 0x300;
    for (unsigned i = 0; i < 6; i++) if (X.mxcsr & (1u << (i + 7))) old |= em[i];
    uint32_t result = (old & ~mask) | (value & mask);
    X.mxcsr = (X.mxcsr & ~0x7f80u) | ((result & 0x300) << 5);
    for (unsigned i = 0; i < 6; i++) if (result & em[i]) X.mxcsr |= 1u << (i + 7);
    return result;
}
static uint64_t c_controlfp(void) { return control_word(ARG(0), ARG(1)); }
static uint64_t c_controlfp_s(void) {
    uint32_t result = control_word(ARG(1), ARG(2));
    if (ARG(0)) x86_wr32(ARG(0), result);
    return 0;
}
