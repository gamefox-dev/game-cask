/* CC0-1.0: x64 static-analysis fixture. It is not executed by the i386 profile. */
#include <windows.h>
#include <emmintrin.h>
int _tls_index;
static volatile unsigned long long local_value; /* TLS execution requires the future Win64 profile. */
__declspec(noinline) unsigned long long integer_math(unsigned long long a, unsigned long long b) {
    local_value = (a << 37) ^ (b >> 3);
    return local_value + 0x123456789abcdef0ULL;
}
__declspec(noinline) __m128d vector_math(__m128d a, __m128d b) { return _mm_add_pd(_mm_mul_pd(a,b),a); }
void entry(void) { ExitProcess((unsigned)integer_math(7,9)); }
