/*
 * Game Cask Browser Target (BGT) — C ABI v0.1
 *
 * Frozen for v0.1. See bgt/abi/ABI.md for the normative description.
 * All values are little-endian, all structs are naturally aligned with
 * explicit padding, a single wasm32 linear memory is used, and every
 * pointer is a uint32 offset into that memory.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef BGT_H
#define BGT_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---------------------------------------------------------------- version */

#define BGT_ABI_VERSION_MAJOR 0
#define BGT_ABI_VERSION_MINOR 3
/* Packed as (major << 16) | (minor << 8) | patch. v0.3.0 == 0x000300 (v0.1/v0.2 games still load). */
#define BGT_ABI_VERSION ((BGT_ABI_VERSION_MAJOR << 16) | (BGT_ABI_VERSION_MINOR << 8))

#if defined(__wasm__)
#define BGT_IMPORT(name) __attribute__((import_module("bgt"), import_name(#name)))
#define BGT_EXPORT(name) __attribute__((export_name(#name)))
#else
#define BGT_IMPORT(name)
#define BGT_EXPORT(name)
#endif

/* ------------------------------------------------------------ error codes */

#define BGT_OK             0
#define BGT_E_INVALID     (-1)  /* malformed argument or payload          */
#define BGT_E_BOUNDS      (-2)  /* pointer/length outside linear memory   */
#define BGT_E_LIMIT       (-3)  /* a documented resource limit exceeded   */
#define BGT_E_UNSUPPORTED (-4)  /* capability or opcode not supported     */
#define BGT_E_NOT_FOUND   (-5)  /* asset/storage key/handle not found     */
#define BGT_E_IO          (-6)  /* storage backend failure                */
#define BGT_E_STATE       (-7)  /* call not valid in current lifecycle    */

/* ----------------------------------------------------------- capabilities */

#define BGT_CAP_AUDIO          (1u << 0)
#define BGT_CAP_STORAGE        (1u << 1)  /* persistent across reloads     */
#define BGT_CAP_TOUCH          (1u << 2)
#define BGT_CAP_GAMEPAD        (1u << 3)
#define BGT_CAP_LINEAR_FILTER  (1u << 4)
#define BGT_CAP_SCISSOR        (1u << 5)
#define BGT_CAP_TRIANGLES      (1u << 6)
#define BGT_CAP_DIRECT_DRAW    (1u << 7)  /* debug/bench reference path    */
#define BGT_CAP_RENDER_TARGETS (1u << 8)  /* v0.2: TEX_CREATE with BGT_TEX_RENDER_TARGET + TARGET op */
#define BGT_CAP_YIELD          (1u << 9)  /* v0.2: bgt_yield() honoured (game built with asyncify) */
#define BGT_CAP_READBACK       (1u << 10) /* v0.3: batched RGBA8 screen/target readback */

#define BGT_BACKEND_NONE     0
#define BGT_BACKEND_WEBGPU   1
#define BGT_BACKEND_WEBGL2   2
#define BGT_BACKEND_HEADLESS 3  /* node/unit-test host, no GPU            */

/* --------------------------------------------------------- virtual buttons */
/* Runtime merges keyboard, gamepad, touch overlay and test input into these. */

#define BGT_BTN_UP     (1u << 0)
#define BGT_BTN_DOWN   (1u << 1)
#define BGT_BTN_LEFT   (1u << 2)
#define BGT_BTN_RIGHT  (1u << 3)
#define BGT_BTN_A      (1u << 4)
#define BGT_BTN_B      (1u << 5)
#define BGT_BTN_X      (1u << 6)
#define BGT_BTN_Y      (1u << 7)
#define BGT_BTN_START  (1u << 8)
#define BGT_BTN_SELECT (1u << 9)
#define BGT_BTN_L      (1u << 10)
#define BGT_BTN_R      (1u << 11)

/* ------------------------------------------------------------- key codes */
/* USB HID usage IDs (keyboard page 0x07). Bit k of keys[] == key k held.  */

#define BGT_KEY_A 4
#define BGT_KEY_Z 29
#define BGT_KEY_1 30
#define BGT_KEY_9 38
#define BGT_KEY_0 39
#define BGT_KEY_ENTER 40
#define BGT_KEY_ESCAPE 41
#define BGT_KEY_BACKSPACE 42
#define BGT_KEY_TAB 43
#define BGT_KEY_SPACE 44
#define BGT_KEY_MINUS 45
#define BGT_KEY_EQUAL 46
#define BGT_KEY_LBRACKET 47
#define BGT_KEY_RBRACKET 48
#define BGT_KEY_BACKSLASH 49
#define BGT_KEY_SEMICOLON 51
#define BGT_KEY_QUOTE 52
#define BGT_KEY_GRAVE 53
#define BGT_KEY_COMMA 54
#define BGT_KEY_PERIOD 55
#define BGT_KEY_SLASH 56
#define BGT_KEY_CAPSLOCK 57
#define BGT_KEY_F1 58
#define BGT_KEY_F12 69
#define BGT_KEY_INSERT 73
#define BGT_KEY_HOME 74
#define BGT_KEY_PAGEUP 75
#define BGT_KEY_DELETE 76
#define BGT_KEY_END 77
#define BGT_KEY_PAGEDOWN 78
#define BGT_KEY_RIGHT 79
#define BGT_KEY_LEFT 80
#define BGT_KEY_DOWN 81
#define BGT_KEY_UP 82
#define BGT_KEY_LCTRL 224
#define BGT_KEY_LSHIFT 225
#define BGT_KEY_LALT 226
#define BGT_KEY_RCTRL 228
#define BGT_KEY_RSHIFT 229
#define BGT_KEY_RALT 230
#define BGT_KEY_CODE(letter) (BGT_KEY_A + ((letter) - 'A'))

/* ------------------------------------------------------------- io events */

#define BGT_EVENT_RESIZED        (1u << 0)
#define BGT_EVENT_DEVICE_RESET   (1u << 1)  /* GPU lost+restored; textures were re-uploaded by runtime */
#define BGT_EVENT_AUDIO_UNLOCKED (1u << 2)
#define BGT_EVENT_FOCUS_LOST     (1u << 3)
#define BGT_EVENT_TARGETS_LOST   (1u << 4)  /* v0.2: render-target contents were lost (device reset); redraw them */

/* game -> runtime flags (bgt_io_t.flags, set in bgt_init) */
#define BGT_FLAG_INTEGER_SCALE   (1u << 0)  /* letterbox with integer scale when possible */
#define BGT_FLAG_POINTER_LOCK    (1u << 1)  /* reserved, unsupported in v0.1 */
/* v0.2: logical_width/height may be changed by the game in any bgt_update; the runtime relayouts. */

#define BGT_MAX_TOUCHES 4

typedef struct bgt_touch {
    int32_t  id;
    int32_t  x;       /* logical pixels */
    int32_t  y;
    uint32_t active;  /* 1 when this slot holds a touch */
} bgt_touch_t;        /* 16 bytes */

/*
 * Shared I/O block. Lives in game memory (static storage). The runtime
 * learns its address from the `bgt_io` export and writes into it; the
 * game only writes the "output" section, during bgt_init.
 */
typedef struct bgt_io {
    /* -- runtime -> game, valid before bgt_init ------------------- 0 */
    uint32_t abi_version;        /*  0 runtime ABI (BGT_ABI_VERSION)        */
    uint32_t backend;            /*  4 BGT_BACKEND_*                         */
    uint32_t caps;               /*  8 BGT_CAP_*                             */
    uint32_t audio_sample_rate;  /* 12 Hz, 0 if audio unavailable           */
    uint32_t seed;               /* 16 deterministic seed (default 1)       */
    uint32_t display_width;      /* 20 canvas backing-store pixels          */
    uint32_t display_height;     /* 24                                       */
    uint32_t arg0;               /* 28 free-form launch argument (?arg0=)   */
    /* -- game -> runtime, written during bgt_init --------------- 32 */
    uint32_t logical_width;      /* 32 game's virtual resolution           */
    uint32_t logical_height;     /* 36                                       */
    uint32_t flags;              /* 40 BGT_FLAG_*                            */
    uint32_t arg1;               /* 44 runtime -> game launch arg (?arg1=)  */
    /* -- runtime -> game, refreshed before every bgt_update ----- 48 */
    uint32_t frame;              /* 48 index of the update about to run     */
    uint32_t buttons;            /* 52 held virtual buttons                 */
    uint32_t buttons_pressed;    /* 56 went down since previous update      */
    uint32_t buttons_released;   /* 60 went up since previous update        */
    uint32_t keys[8];            /* 64 256-bit held set, HID usage index    */
    uint32_t keys_pressed[8];    /* 96 went down since previous update      */
    int32_t  pointer_x;          /*128 logical pixels (may be out of range) */
    int32_t  pointer_y;          /*132                                       */
    uint32_t pointer_buttons;    /*136 bit0 primary, bit1 secondary, bit2 middle */
    uint32_t pointer_inside;     /*140 1 if pointer is over the game area   */
    int16_t  axes[4];            /*144 gamepad LX,LY,RX,RY in -32767..32767 */
    uint32_t touch_count;        /*152                                       */
    uint32_t events;             /*156 BGT_EVENT_* since previous update    */
    bgt_touch_t touches[BGT_MAX_TOUCHES]; /* 160 */
} bgt_io_t;                      /* 224 bytes */

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(bgt_touch_t) == 16, "bgt_touch_t layout");
_Static_assert(sizeof(bgt_io_t) == 224, "bgt_io_t layout");
_Static_assert(offsetof(bgt_io_t, logical_width) == 32, "bgt_io_t layout");
_Static_assert(offsetof(bgt_io_t, frame) == 48, "bgt_io_t layout");
_Static_assert(offsetof(bgt_io_t, pointer_x) == 128, "bgt_io_t layout");
_Static_assert(offsetof(bgt_io_t, touches) == 160, "bgt_io_t layout");
#endif

static inline int bgt_key_down(const bgt_io_t *io, uint32_t key) {
    return key < 256 && ((io->keys[key >> 5] >> (key & 31)) & 1u);
}
static inline int bgt_key_pressed(const bgt_io_t *io, uint32_t key) {
    return key < 256 && ((io->keys_pressed[key >> 5] >> (key & 31)) & 1u);
}

/* -------------------------------------------------- runtime imports ("bgt") */

#define BGT_LOG_DEBUG 0
#define BGT_LOG_INFO  1
#define BGT_LOG_WARN  2
#define BGT_LOG_ERROR 3

/* Logging. Text is UTF-8, explicit length, no terminator required. */
BGT_IMPORT(log)   void bgt_log(uint32_t level, const char *ptr, uint32_t len);
typedef struct bgt_gpu_limits {
    uint32_t byte_size, max_texture_dimension, max_texture_handles, texture_budget_bytes;
} bgt_gpu_limits_t; /* 16 bytes */
BGT_IMPORT(gpu_limits) int32_t bgt_gpu_limits(bgt_gpu_limits_t *dst, uint32_t cap);

/* v0.3 asynchronous request results. status: 0 pending, 1 ready, or error. Reads do not consume.
 * Completion becomes visible only on a later bgt_update (normally after bgt_yield). */
BGT_IMPORT(request_status) int32_t bgt_request_status(uint32_t request);
BGT_IMPORT(request_read) int32_t bgt_request_read(uint32_t request, void *dst, uint32_t cap);
BGT_IMPORT(request_close) int32_t bgt_request_close(uint32_t request);
/* Fatal error. Never returns: the runtime stops the game loop and shows an error. */
BGT_IMPORT(abort) void bgt_abort(int32_t code, const char *ptr, uint32_t len);

/* Submit an encoded command buffer (see bgt_cmd.h). Returns BGT_OK or a
 * negative error. Commands are validated and copied before returning; the
 * buffer may be reused immediately. Draws accumulate until bgt_render returns. */
BGT_IMPORT(submit_commands) int32_t bgt_submit_commands(const void *ptr, uint32_t byte_len);

/* Virtual file system (read-only, preloaded before bgt_init, synchronous).
 * Paths are UTF-8, relative, '/'-separated, without "." or ".." segments. */
BGT_IMPORT(asset_open)  int32_t bgt_asset_open(const char *path, uint32_t path_len); /* handle > 0, or error */
BGT_IMPORT(asset_size)  int32_t bgt_asset_size(int32_t handle);
BGT_IMPORT(asset_read)  int32_t bgt_asset_read(int32_t handle, void *dst, uint32_t size); /* bytes read, 0 at EOF */
BGT_IMPORT(asset_seek)  int32_t bgt_asset_seek(int32_t handle, uint32_t offset);
BGT_IMPORT(asset_close) int32_t bgt_asset_close(int32_t handle);

/* Audio: signed 16-bit mono PCM at io->audio_sample_rate. Returns frames
 * accepted (may be fewer than offered when the queue is full or audio is
 * still locked; audio is unlocked by the first user gesture). */
BGT_IMPORT(audio_push)   int32_t bgt_audio_push(const int16_t *samples, uint32_t frames);
BGT_IMPORT(audio_queued) int32_t bgt_audio_queued(void); /* frames scheduled but not yet played */

/* Small key/value persistence. Keys: 1..64 bytes of [A-Za-z0-9_.-].
 * Values: at most 65536 bytes. read returns the full value length (which may
 * exceed cap; only cap bytes are copied), or BGT_E_NOT_FOUND. */
BGT_IMPORT(storage_read)  int32_t bgt_storage_read(const char *key, uint32_t key_len, void *dst, uint32_t cap);
BGT_IMPORT(storage_write) int32_t bgt_storage_write(const char *key, uint32_t key_len, const void *src, uint32_t len);

/* v0.2: suspend the game until the next frame, from anywhere on the call stack. Valid only inside
 * bgt_update, and only in games built with "asyncify": true (game.json) which export
 * bgt_async_buffer. Lets blocking legacy loops (message pumps, vsync waits) run unchanged:
 * the runtime unwinds the stack, returns from bgt_update, and resumes right here next frame. */
BGT_IMPORT(yield) void bgt_yield(void);

/* Wall-clock microseconds for profiling only. Never use for simulation. */
BGT_IMPORT(time_us) double bgt_time_us(void);

/* Debug/bench reference path: one import call per sprite (BGT_CAP_DIRECT_DRAW).
 * Exists only to measure the command-buffer path against; do not ship ports on it. */
BGT_IMPORT(debug_draw_sprite) void bgt_debug_draw_sprite(uint32_t texture, float x, float y, float w, float h,
                                                         float u0, float v0, float u1, float v1, uint32_t rgba);

/* ---------------------------------------------------- game exports ("bgt_*") */
/*
 * Required:
 *   uint32_t bgt_abi_version(void);        returns BGT_ABI_VERSION the game was built against
 *   uint32_t bgt_io(void);                 address of the game's static bgt_io_t
 *   int32_t  bgt_init(uint32_t io_ptr);    BGT_OK or negative error; set logical size here
 *   void     bgt_update(uint32_t dt_us);   one fixed simulation step (dt is constant, 16667)
 *   void     bgt_render(void);             record + submit draw commands; must not advance simulation
 *   void     bgt_shutdown(void);
 * Optional:
 *   uint32_t bgt_state_hash(void);         stable hash of deterministic simulation state
 *   uint32_t bgt_async_buffer(void);       v0.2, required with bgt_yield: address of a game-owned
 *                                          buffer (>= 64 KiB, 8-byte aligned) for the asyncify stack;
 *                                          its first 8 bytes are overwritten by the runtime
 *   uint32_t bgt_async_buffer_size(void);  its size in bytes
 *   uint32_t bgt_metrics(void);            v0.2, optional: address of NUL-terminated JSON with kit metrics
 *                                          (e.g. lifted vs interpreted instructions, stubs hit)
 *   uint32_t bgt_debug_state(void);        address of a game-owned NUL-terminated UTF-8 JSON
 *                                          string describing observable state (debug/test only;
 *                                          valid until the next bgt_* call)
 */

/* Defines the static io block plus the bgt_io / bgt_abi_version exports. */
#define BGT_DEFINE_IO(var)                                                    \
    static bgt_io_t var;                                                      \
    BGT_EXPORT(bgt_io) uint32_t bgt_io(void) { return (uint32_t)(uintptr_t)&var; } \
    BGT_EXPORT(bgt_abi_version) uint32_t bgt_abi_version(void) { return BGT_ABI_VERSION; }

#define BGT_DT_US 16667u  /* fixed timestep: 1/60 s rounded */

#define BGT_LOG_LITERAL(level, s) bgt_log((level), (s), (uint32_t)(sizeof(s) - 1))

#ifdef __cplusplus
}
#endif

#endif /* BGT_H */
