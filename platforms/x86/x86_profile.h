/* Bounded execution census and sampled wall timing. SPDX-License-Identifier: MIT */
#ifndef X86_PROFILE_H
#define X86_PROFILE_H
#include "x86_arch.h"
#ifndef X86_PROFILE_ENABLED
#define X86_PROFILE_ENABLED 1
#endif
#ifndef X86_PROFILE_SAMPLE
#define X86_PROFILE_SAMPLE 1024u
#endif
#define X86_CENSUS_CAP 262144u
#define X86_CENSUS_TOP 32u
enum { XP_NATIVE, XP_GENERIC, XP_INTERPRETER, XP_API, XP_CATEGORIES };
typedef struct { uint32_t address, reason; uint64_t count, instructions; } x86_census_t;
typedef struct { uint64_t calls, samples; double sample_us; } x86_timing_t;
extern x86_timing_t x86_timings[XP_CATEGORIES];
extern x86_census_t x86_census[X86_CENSUS_CAP];
extern uint64_t x86_census_dropped;
extern uint64_t x86_census_generation;
extern uint64_t x86_census_window_start_clock;
void x86_profile_reset(void);
extern double x86_profile_idle_us;
extern double x86_interpreter_exclusive_sample_us;
/* Non-extrapolated disjoint interpreter spans, closed across frame waits. */
double x86_interpreter_exclusive_us(void);
/* Host exception/trap boundary; timestamp in bgt.time_us units, NaN discards open span. */
void x86_profile_abort(double now_us);
/* Returns an index+1; zero is a counted overflow. No eviction or invented counts. */
uint64_t x86_profile_exit(uint32_t address, uint32_t reason);
void x86_profile_instruction(uint64_t bucket);
double x86_profile_begin(unsigned category);
void x86_profile_end(unsigned category, double start);
double x86_profile_clock(void);
void x86_profile_idle_begin(void);
void x86_profile_idle_end(void);
#endif
