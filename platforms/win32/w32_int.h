/*
 * Win32 platform profile — internal header. The profile implements, on top of BGT, the subset of
 * the Win32 API that a game's modules import: window manager + message queue (USER32), GDI drawing
 * on BGT render targets (GDI32), process/heap/time (KERNEL32), the MSVC runtime, the registry
 * (ADVAPI32, on bgt_storage). Unknown imports become counted stubs (a kit gap, visible in metrics).
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef W32_INT_H
#define W32_INT_H

#include "bgt.h"
#include "bgt_cmd.h"
#include "x86_sem.h"
#include "w32.h"

/* ------------------------------------------------------------------ guest memory map */
#ifdef X86_FLAT_GUEST
#define W32_STACK_LO 0x00800000u
#define W32_STACK_HI 0x00a00000u
#define W32_HEAP_LO 0x04000000u
#define W32_HEAP_HI (X86_FLAT_BYTES - 65536u)
#define W32_THUNK_LO 0x00b00000u
#define W32_MISC 0x00c00000u
#define W32_TEB 0x00a00000u
#define W32_PEB 0x00a01000u
#define W32_SYSDLL_BASE 0x00d00000u
#else
#define W32_STACK_LO 0x00200000u
#define W32_STACK_HI 0x00400000u   /* 2 MiB; exe images normally start at 0x00400000 */
#define W32_HEAP_LO 0x20000000u
#define W32_HEAP_HI 0x30000000u
#define W32_THUNK_LO 0x7f000000u   /* 16 bytes per import slot */
#define W32_MISC 0x7f100000u       /* platform-owned guest scratch (strings handed to the guest) */
#define W32_TEB 0x7ffde000u
#define W32_PEB 0x7ffdf000u
#define W32_SYSDLL_BASE 0x7f200000u /* pseudo module handles for system DLLs */
#endif
#define W32_THUNK_SLOTS 4096u
#define W32_THUNK_HI (W32_THUNK_LO + 16u * W32_THUNK_SLOTS)
#define W32_MISC_SIZE 0x00100000u

/* handle spaces */
#define H_WND 0x00010000u
#define H_DC 0x00020000u
#define H_OBJ 0x00030000u
#define H_MENU 0x00040000u
#define H_ICON 0x00050000u
#define H_KEY 0x00060000u
#define H_ACCEL 0x00070000u
#define H_HEAP 0x00080000u

#define NWND 128
#define NDC 128
#define NOBJ 1024
#define NCLASS 32
#define NTIMER 32
#define NMOD 8

/* reserved BGT texture handles */
#define TEX_SCREEN 1u
#define TEX_FONT 2u
#define TEX_FIRST_BITMAP 3u
#define TEX_LIMIT 1023u

extern bgt_io_t *w32_io;
extern w32_metrics_t w32_m;

/* ------------------------------------------------------------------ helpers */
#ifdef X86_FLAT_GUEST
#define W32_64 1
#else
#define W32_64 0
#endif
static inline uint64_t w32_arg64(uint32_t n) { static const int r[4]={ECX,EDX,R8,R9};return n<4?X.r[r[n]]:x86_rd64((uint32_t)X.r[ESP]+40u+8u*(n-4)); }
#define ARG64(n) (W32_64?w32_arg64(n):x86_rd32((uint32_t)X.r[ESP]+4u+4u*(n)))
#define ARG(n) ((uint32_t)ARG64(n))
static inline uint32_t w32_ptr_size(void) {return W32_64?8:4;}
static inline uint64_t w32_rdptr(uint32_t p){return W32_64?x86_rd64(p):x86_rd32(p);}
static inline void w32_wrptr(uint32_t p,uint64_t v){if(W32_64)x86_wr64(p,v);else x86_wr32(p,(uint32_t)v);}
static inline int32_t imin(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t imax(int32_t a, int32_t b) { return a > b ? a : b; }
uint32_t w32_slen(const char *s);
void w32_log(const char *s);
void w32_logf2(const char *a, const char *b);
/* read a guest string (ANSI when wide == 0, UTF-16 otherwise) into ASCII, '?' for non-ASCII */
uint32_t w32_gstr(uint32_t addr, int wide, char *dst, uint32_t cap);
uint32_t w32_gstrn(uint32_t addr, int32_t n, int wide, char *dst, uint32_t cap);
/* write an ASCII string into guest memory (ANSI or UTF-16), NUL-terminated, truncated to cap chars */
uint32_t w32_pstr(uint32_t addr, uint32_t cap, int wide, const char *s);
/* platform-owned guest memory (never freed) */
uint32_t w32_misc_alloc(uint32_t n);
int w32_streqi(const char *a, const char *b);

/* guest heap */
uint32_t w32_heap_alloc(uint32_t n, int zero);
void w32_heap_free(uint32_t a);
uint32_t w32_heap_size(uint32_t a);
uint32_t w32_heap_realloc(uint32_t a, uint32_t n);
uint32_t w32_virtual_map(uint32_t addr, uint32_t size);

/* time */
uint32_t w32_now_ms(void);
void w32_sleep_ms(uint32_t ms);
uint32_t w32_shell_about(int wide);

/* modules */
typedef struct {
    char name[256];
    uint32_t base, size, entry;
    int is_dll;
    uint32_t rsrc_rva, export_rva, export_size, pdata_rva, pdata_size, tls_rva;
} w32_module_t;
extern w32_module_t w32_mods[NMOD];
extern uint32_t w32_nmods;
uint64_t w64_api(const char *name,int *handled);
uint64_t w32_longptr64(uint32_t hwnd,int32_t index,uint64_t value,int set);
uint64_t w32_send64(uint32_t hwnd,uint32_t msg,uint64_t wp,uint64_t lp);
uint32_t w64_lookup(uint32_t pc,uint32_t *base);
void w64_context_save(uint32_t ctx,int caller);
void w64_context_restore(uint32_t ctx);
uint32_t w64_virtual_unwind(uint32_t type,uint32_t base,uint32_t pc,uint32_t fn,uint32_t ctx,uint32_t data,uint32_t frame);
void w64_tls_init(void);
w32_module_t *w32_mod_by_handle(uint32_t h);
uint32_t w32_export_addr(const w32_module_t *m, const char *name, uint32_t ordinal);

/* resources (in mapped guest images) */
uint32_t w32_res_find(uint32_t hmod, uint32_t type, uint32_t name_or_id, int name_wide, uint32_t *size);
uint32_t w32_res_find_str(uint32_t hmod, uint32_t type, const char *name, uint32_t *size);
int32_t w32_load_string(uint32_t hmod, uint32_t id, char *dst, uint32_t cap);
uint32_t w32_res_entry(uint32_t hmod, uint32_t type, uint32_t name_or_id, int name_wide);
uint32_t w32_data_import(const char *name);
uint32_t w32_format_to_guest(uint32_t dst, uint32_t cap, int wide, uint32_t fmt, uint32_t va);

/* Shared CRT registry (UCRT api-sets + ucrtbase.dll + msvcrt.dll) */
typedef uint64_t (*w32_crt_fn)(void);
typedef struct {
    const char *name;
    const char *group;
    w32_crt_fn fn;
    uint8_t is_data;
} w32_crt_entry_t;
extern const w32_crt_entry_t w32_crt_table[];
extern const uint32_t w32_crt_table_n;
const w32_crt_entry_t *w32_find_crt(const char *name);
uint32_t w32_crt_data(const char *name);

/* Profile file access shared with CRT FILE* I/O */
uint32_t w32_file_open_str(const char *raw, int wide);
int w32_file_read_buf(uint32_t h, uint8_t *dst, uint32_t want, uint32_t *got);
int w32_file_seek_pos(uint32_t h, int64_t delta, uint32_t method, uint64_t *pos_out);
int w32_file_size_get(uint32_t h, uint64_t *size_out);
int w32_file_close_h(uint32_t h);
uint64_t w32_unix_time_secs(void);
void w32_exit_guest(uint32_t code);
uint32_t w32_get_cmdline(int wide);

/* API registry */
typedef uint32_t (*w32_api_fn)(void);
typedef struct { const char *name; uint8_t nargs; uint8_t cdecl; w32_api_fn fn; } w32_api_t;
extern const w32_api_t w32_api_kernel[], w32_api_user[], w32_api_gdi[];
extern const uint32_t w32_api_kernel_n, w32_api_user_n, w32_api_gdi_n;
uint32_t w32_thunk_for(const char *dll, const char *name);
const w32_api_t *w32_find_api(const char *name);
/* thunk (or data cell) for an API the profile implements, 0 if it does not implement `name` */
uint32_t w32_resolve_api(const char *dll, const char *name);
/* "C:\\X\\Foo" -> "Foo.dll" (LoadLibrary rules: path stripped, ".dll" appended when there is no extension) */
void w32_module_name(const char *raw, char *out, uint32_t cap);
/* is `name` a system DLL the profile implements (game.json-independent, from platforms/win32/dlls.json)? */
int w32_is_sys_dll(const char *name);
/* pseudo module handle of a profile DLL: registered when `load` (LoadLibrary, static import), else only if loaded */
uint32_t w32_sysdll_handle(const char *name, int load);
const char *w32_sysdll_name(uint32_t h);
/* set by an API to stop the guest (ExitProcess) */
extern int w32_exited;
extern uint32_t w32_exit_code;

/* frame pumping: wait for the next frame (bgt_yield), then turn input into messages and fire timers */
void w32_wait_frame(void);
/* per-frame input -> messages (called after every yield) */
void w32_user_pump_input(void);
void w32_user_fire_timers(void);
void w32_user_init(void);
uint32_t w32_user_main_hwnd(void);
void w32_user_targets_lost(void);
void w32_user_present_overlay(void);
int32_t w32_user_menu_h(uint32_t hwnd);
void w32_user_window_rect(uint32_t hwnd, int32_t *x, int32_t *y, int32_t *w, int32_t *h);
int w32_user_client(uint32_t hwnd, int32_t *x, int32_t *y, int32_t *w, int32_t *h);
uint32_t w32_sys_color(uint32_t idx);
/* Visible-region exclusions in desktop coordinates, shared by all window DC primitives. */
uint32_t w32_user_exclusions(uint32_t hwnd, int32_t rects[NWND][4]);
void w32_gdi_chrome_begin(void);
void w32_gdi_chrome_end(void);
uint32_t w32_user_font(uint32_t hwnd);
uint32_t w32_gdi_make_font(int32_t height, int32_t weight);
void w32_chrome_select_font(uint32_t font);

/* ------------------------------------------------------------------ GDI recorder (deferred BGT commands) */
void w32_gdi_init(void);
/* screen render target (desktop): created/resized when the main window is sized */
void w32_gdi_screen(int32_t w, int32_t h);
int32_t w32_gdi_screen_w(void);
int32_t w32_gdi_screen_h(void);
/* drawing into a target with a clip rect (target coords) */
void g_fill(uint32_t tex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb, uint32_t blend);
void g_text(uint32_t tex, int32_t cl, int32_t ct, int32_t cr, int32_t cb, int32_t x, int32_t y, const char *s, int32_t n, uint32_t rgb, int32_t scale);
int32_t g_text_w(int32_t n, int32_t scale);
typedef struct { int32_t height, ascent, descent, advance, weight; } w32_font_t;
w32_font_t w32_font_metrics(int32_t height, int32_t weight);
void w32_gdi_flush_and_present(void);
/* CPU replay of recorded GDI ops (w32_replay.c): exact pixel reads on GPU surfaces, enabled on demand */
void w32_rp_enable(void);
int w32_rp_enabled(void);
void w32_rp_create(uint32_t tex, int32_t w, int32_t h, const uint32_t *px);
void w32_rp_delete(uint32_t tex);
void w32_rp_fill(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgba, uint32_t blend);
void w32_rp_blit(uint32_t dtex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t stex, float u0, float v0, float u1, float v1, uint32_t blend, uint32_t tint);
void w32_rp_upload(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, const uint32_t *px);
int w32_rp_pixel(uint32_t tex, int32_t x, int32_t y, uint32_t *rgba);
int w32_rp_read(uint32_t tex, int32_t x, int32_t y, int32_t w, int32_t h, uint32_t *out);
/* names of APIs that read pixels back (their import or GetProcAddress enables the replay) */
int w32_is_pixel_read_api(const char *name);
void w32_gdi_targets_lost(void);
/* simple helpers for platform-drawn chrome (menus, message boxes) on the screen target */
void w32_chrome_fill(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb);
void w32_chrome_frame(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t rgb);
void w32_chrome_text(int32_t x, int32_t y, const char *s, uint32_t rgb);
/* invalidate everything drawn by the guest (after modal chrome closes or targets are lost) */
void w32_user_invalidate_all(void);

/* ------------------------------------------------------------------ debug JSON (read-only views for tests) */
typedef struct { char *b; uint32_t n, cap; } w32_json_t;
void wj_raw(w32_json_t *j, const char *s);
void wj_str(w32_json_t *j, const char *s);   /* quoted + escaped */
void wj_int(w32_json_t *j, int64_t v);
void wj_rect(w32_json_t *j, int32_t x, int32_t y, int32_t w, int32_t h); /* [x,y,w,h] */
/* the profile's UI layout (menu bar, open popup, message box, windows/dialogs/controls), logical px */
void w32_user_debug_ui(w32_json_t *j);

#define RGB24(r, g, b) ((uint32_t)(r) | ((uint32_t)(g) << 8) | ((uint32_t)(b) << 16))

#endif
