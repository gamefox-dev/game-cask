/* Bounded execution census and sampled wall timing. SPDX-License-Identifier: MIT */
#ifndef X86_PROFILE_H
#define X86_PROFILE_H
#include <stdint.h>
#ifndef X86_PROFILE_ENABLED
#define X86_PROFILE_ENABLED 1
#endif
#ifndef X86_PROFILE_SAMPLE
#define X86_PROFILE_SAMPLE 1024u
#endif
#define X86_CENSUS_CAP 16384u
#define X86_CENSUS_TOP 32u
enum { XP_NATIVE, XP_GENERIC, XP_INTERPRETER, XP_API, XP_CATEGORIES };
enum { XE_FORM=1, XE_GUARD, XE_QUANTUM, XE_INTERIOR, XE_INDIRECT, XE_OTHER, XE_INTERPRETER };
typedef struct { uint32_t address, reason; uint64_t count, instructions; } x86_census_t;
typedef struct { uint64_t calls, samples; double sample_us; } x86_timing_t;
extern x86_timing_t x86_timings[XP_CATEGORIES];
extern x86_census_t x86_census[X86_CENSUS_CAP];
extern uint64_t x86_census_dropped;
extern double x86_profile_idle_us;
/* Returns an index+1; zero is a counted overflow. No eviction or invented counts. */
uint32_t x86_profile_exit(uint32_t address, uint32_t reason);
void x86_profile_instruction(uint32_t bucket);
double x86_profile_begin(unsigned category);
void x86_profile_end(unsigned category, double start);
double x86_profile_clock(void);
void x86_profile_idle_begin(void);
void x86_profile_idle_end(void);
#endif
