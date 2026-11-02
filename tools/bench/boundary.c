/* Original CC0-1.0 generic-boundary benchmark: conversions, thunks and vtables.
 * No game input. Exact integer checksum; compiled as an ordinary Windows CRT program. */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>

typedef uint32_t (*method)(uint32_t);
__declspec(noinline) static uint32_t step_a(uint32_t x) { return x + 3; }
__declspec(noinline) static uint32_t step_b(uint32_t x) { return x ^ 0x55; }
static method volatile vtable[2] = {step_a, step_b};
static DWORD (WINAPI *volatile read_error)(void) = GetLastError;
static void (WINAPI *volatile write_error)(DWORD) = SetLastError;

__declspec(noinline) static uint32_t convert(int32_t x) {
    float single;
    double real;
    int32_t result;
    /* Keep actual scalar opcode forms, independent of compiler folding/vectorization. */
    __asm__ volatile("cvtsi2ss %1, %0" : "=x"(single) : "r"(x));
    __asm__ volatile("cvtss2sd %1, %0" : "=x"(real) : "x"(single));
    __asm__ volatile("subsd %1, %0" : "+x"(real) : "x"(0.0));
    __asm__ volatile("cvttsd2si %1, %0" : "=r"(result) : "x"(real));
    return (uint32_t)result;
}
int main(void) {
    uint32_t sum = 0;
    for (uint32_t i = 0; i < 100000; i++) {
        uint32_t x = convert((int32_t)(i & 1023));
        write_error(i ^ 0x1234);
        if (read_error() != (i ^ 0x1234)) { OutputDebugStringA("boundary FAIL last-error"); return 1; }
        sum += vtable[i & 1](x);
    }
    char text[80]; snprintf(text, sizeof text, "boundary checksum %08x", (unsigned)sum);
    OutputDebugStringA(text);
    for (;;) Sleep(5);
}
