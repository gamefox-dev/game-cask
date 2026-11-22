/* OpenGL 3.3 -> BGT §13. Engine-independent, bounded profile. SPDX-License-Identifier: MIT — LANE-GL */
#include "w32_gl.h"
/* Deterministic test work census; compiled out of production hot paths. */
#ifdef W32_GL_TEST_WORK
static uint32_t gl_test_work;
#define GL_WORK() (++gl_test_work)
#else
#define GL_WORK() ((void)0)
#endif

/* ABI §13.1: bounded live objects, NOT a bound on GLuint values. Slot zero is default state. */
/* Test-only demand probe: never an ABI promise. Real transport still validates its caps. */
#ifndef W32_GL_TEST_CAPACITY
#define W32_GL_TEST_CAPACITY BGT_GPU_LIMIT_HANDLES
#endif
#define GPU_MAX W32_GL_TEST_CAPACITY
#define N (W32_GL_TEST_CAPACITY + 1u)
#define BAD_ENUM 0x500u
#define BAD_VALUE 0x501u
#define BAD_OP 0x502u
#define OOM 0x505u
#define F32 0x1406u
#define U8 0x1401u
#define U16 0x1403u
#define U32 0x1405u
#define TEXTURE_2D 0xde1u
#define ARRAY_BUFFER 0x8892u
#define ELEMENT_BUFFER 0x8893u
#define UNIFORM_BUFFER 0x8a11u
#define FEEDBACK_BUFFER 0x8c8eu
#define FRAMEBUFFER 0x8d40u
#define RENDERBUFFER 0x8d41u
#define RGBA 0x1908u
#define DEPTH_STENCIL 0x88f0u
#define PTR(p) ((uint32_t)(uintptr_t)(p))
uint64_t w32_gl_calls, w32_gl_draws, w32_gl_state_changes, w32_gl_pipelines, w32_gl_unimplemented,
    w32_gl_approximations;
uint64_t w32_gl_buffer_respec_reused, w32_gl_buffer_respec_resized, w32_gl_buffer_respec_grew, w32_gl_buffer_respec_shrank;
static uint32_t error, context, current, dc, pixel_format, interval = 1;
static char stub_json[8192] = "[]";
static uint32_t stub_len = 1;
static uint32_t request_id = 0x70000000u;
static uint32_t screen_depth, depth_handle = 900;
static uint32_t cmd_mem[4096];
static bgt_cmdbuf_t cmd;
static uint32_t width(void) { return w32_io->logical_width; }
static uint32_t height(void) { return w32_io->logical_height; }
static void flush_pending(void);
/* K60: profile validation errors no longer flush deferred work (K53 flushed so that an earlier deferred
 * failure kept first-error order). While deferred calls are pending, the error is latched at once (callers
 * use it for control flow) and its stream position is remembered: `err_seq` is the sequence number of the
 * newest deferred call before it. If a later flush finds that a deferred call at or before that position
 * failed, that call's error preceded the latched one, and glGetError returns it instead (`latch_fix`).
 * Profile regions that save and restore `error` themselves (`latch_local`) keep the K53 flush. `latch_outer`
 * is the error latched before the current API call (the API wrapper clears `error` during a call). */
static uint32_t latch_outer, latch_local, latch_fix;
static int fail_deferred(uint32_t e);
/* K61: every raised error is counted (gl_errors_raised) and attributed to the running entry point (gl_error_calls). */
uint64_t w32_gl_errors_raised;
static void fail(uint32_t e) { w32_gl_errors_raised++; if (fail_deferred(e)) return; flush_pending(); if (!error) error = e; }
static int eq(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; } return *a == *b;
}
static void copy(void *d, const void *s, uint32_t n) {
    for (uint32_t i = 0; i < n; i++) ((uint8_t *)d)[i] = ((const uint8_t *)s)[i];
}
static void zero(void *d, uint32_t n) { for (uint32_t i = 0; i < n; i++) ((uint8_t *)d)[i] = 0; }
static uint32_t bits(float f) { union { float f; uint32_t u; } v = {f}; return v.u; }
static float argf(uint32_t n) {
    if (W32_64 && n < 4) return X.xmm[n].f32[0];
    union { uint32_t u; float f; } v = {ARG(n)}; return v.f;
}
static double argd(uint32_t n) {
    if (W32_64 && n < 4) return X.xmm[n].f64[0];
    union { uint64_t u; double d; } v = {W32_64 ? ARG64(n) : x86_rd64((uint32_t)X.r[ESP] + 4 + n * 4)};
    return v.d;
}
static void *glp_alloc(uint32_t n);
static void glp_free(void *p, uint32_t n);
static void *guest(uint32_t p, uint32_t n) {
    uint8_t *v = glp_alloc(n ? n : 1);
    if (!v) { fail(OOM); return 0; }
    for (uint32_t i = 0; i < n; i++) v[i] = p ? x86_rd8(p + i) : 0;
    return v;
}
static void begin(void) { bgt_cmd_init(&cmd, cmd_mem, sizeof cmd_mem); }
static void op(uint32_t code, const uint32_t *w, uint32_t n) {
    bgt__gpu_copy(bgt_cmd_push(&cmd, (uint16_t)code, n * 4), w, n * 4);
}
static int flush_padded_cleanup(void);
/* K50 review: interval-0 presents share one host update, so every per-host-frame budget the host
 * enforces is tracked here exactly as the host charges it: §13.12 wire bytes and commands, the legacy
 * list allowance, queued upload/source bytes (gpu_budget_bytes) and GPU vertices. A present lets the
 * guest continue only while one more frame of the costliest recent frame still fits every budget, so
 * sharing never causes a rejection that a one-present-per-update guest would not see. */
typedef struct { uint64_t bytes, commands, lists, uploads, vertices; } gpu_usage_t;
static gpu_usage_t frame_use, guest_frame, recent_frames[4];
static uint32_t frame_epoch, upload_budget = 268435456u;
static void host_frame_sync(void) {
    if (frame_epoch != w32_m.yields) { frame_epoch = w32_m.yields; frame_use = (gpu_usage_t){0}; }
}
static void usage_add(gpu_usage_t *a, const gpu_usage_t *b) {
    a->bytes += b->bytes; a->commands += b->commands; a->lists += b->lists; a->uploads += b->uploads; a->vertices += b->vertices;
}
static uint32_t word_at(const uint8_t *p) { uint32_t v; copy(&v, p, 4); return v; }
/* Host-side data pointer/length words of the six owned-upload opcodes (commands-gpu.ts copy()). */
static int data_words(uint32_t code, uint32_t *ptr, uint32_t *len) {
    switch (code) {
    case 0x40: case 0x48: case 0x61: *ptr = 3; *len = 4; return 1;
    case 0x41: *ptr = 2; *len = 3; return 1;
    case 0x44: *ptr = 6; *len = 7; return 1;
    case 0x5a: *ptr = 8; *len = 9; return 1;
    default: return 0;
    }
}
static gpu_usage_t measure(const uint8_t *buf, uint32_t len, uint32_t count, uint16_t flags) {
    gpu_usage_t u = {len, count, !flags, 0, 0};
    for (uint32_t off = 16; off + 8 <= len;) {
        uint32_t code = buf[off] | ((uint32_t)buf[off + 1] << 8), size = word_at(buf + off + 4), p, l;
        const uint8_t *w = buf + off + 8;
        if (data_words(code, &p, &l) && size >= (l + 1) * 4) u.uploads += word_at(w + l * 4);
        if (code == 0x64 && size >= 20) u.uploads += 2ull * ((word_at(w + 16) + 3) & ~3u);
        if ((code == 0x57 || code == 0x58) && size >= 8) u.vertices += (uint64_t)word_at(w) * word_at(w + 4);
        off += 8 + size;
    }
    return u;
}
/* K50 review ruling: when an update ends without a present after at least one interval-0 present,
 * the GPU work issued after that present must not be shown this update. While `deferring`, finished
 * lists (with private copies of their upload data) are journaled in order, then submitted at the next
 * present or at the start of the next host update. The journal is bounded so that it always fits an
 * empty host frame, and it is only submitted into the current host frame when its measured cost fits
 * there; otherwise the update ends first (at the present, or by a transport-only yield) and it is
 * submitted at the start of the next one. It is submitted before the next present only when a GL
 * request needs a result or it is full; an update that then ends without a present counts as a torn
 * frame. Upload copies are addressed by journal offset, rebased at submission (the journal can move
 * when it grows). Journaled lists report success. A host rejection of deferred work (not expected:
 * every per-frame budget is checked first) still sets the GL error, at submission time, so it is
 * attributed to whichever GL call is current then; GL's first-error latch is otherwise unchanged. */
#define JOURNAL_MAX (32u << 20)
static uint8_t *journal; static uint32_t journal_len, journal_cap, deferring, exposed, in_hook;
static gpu_usage_t journal_use;
static uint64_t gl_torn_frames, gl_deferred_lists, gl_deferred_rejects, gl_deferred_yields;
static int fits(const gpu_usage_t *base, const gpu_usage_t *extra) {
    return base->bytes + extra->bytes <= BGT_GPU_CONTINUATION_BYTES &&
        base->commands + extra->commands <= BGT_GPU_CONTINUATION_COMMANDS &&
        base->lists + extra->lists <= 256 && base->uploads + extra->uploads <= upload_budget &&
        base->vertices + extra->vertices <= 1572864u;
}
static int journal_fits_frame(void) { host_frame_sync(); return fits(&frame_use, &journal_use); }
/* Wire words carry 32-bit wasm addresses (PTR). In wasm this is the identity; the 64-bit native test
 * adapter keeps all profile memory in one static image, so the upper address bits are shared. */
static const void *wire_address(uint32_t p) {
    return (const void *)(((uintptr_t)&frame_use & ~(uintptr_t)UINT32_MAX) | p);
}
static int journal_add(const uint8_t *buf, uint32_t len, const gpu_usage_t *u) {
    gpu_usage_t total = journal_use, empty = {0}; usage_add(&total, u);
    if (!fits(&empty, &total)) return 0; /* the deferred span must fit a fresh host frame */
    uint64_t wide = 8 + (((uint64_t)len + 3) & ~3ull); /* 64-bit: upload sizes can approach 4 GiB */
    for (uint32_t off = 16; off + 8 <= len;) {
        uint32_t code = buf[off] | ((uint32_t)buf[off + 1] << 8), size = word_at(buf + off + 4), p, l;
        if (data_words(code, &p, &l) && size >= (l + 1) * 4) wide += ((uint64_t)word_at(buf + off + 8 + l * 4) + 3) & ~3ull;
        off += 8 + size;
    }
    if (wide > (uint64_t)JOURNAL_MAX - journal_len) return 0;
    uint32_t need = (uint32_t)wide;
    if (journal_len + need > journal_cap) {
        uint32_t cap = journal_cap ? journal_cap : 65536;
        while (cap < journal_len + need) cap = cap > JOURNAL_MAX / 2 ? JOURNAL_MAX : cap * 2;
        uint8_t *grown = glp_alloc(cap);
        if (!grown) return 0;
        if (journal) { copy(grown, journal, journal_len); glp_free(journal, journal_cap); }
        journal = grown; journal_cap = cap;
    }
    uint8_t *entry = journal + journal_len, *list = entry + 8;
    uint32_t blob = journal_len + 8 + ((len + 3) & ~3u); /* journal offset, never an address */
    copy(entry, &need, 4); copy(entry + 4, &len, 4); copy(list, buf, len);
    for (uint32_t off = 16; off + 8 <= len;) {
        uint32_t code = list[off] | ((uint32_t)list[off + 1] << 8), size = word_at(list + off + 4), p, l;
        if (data_words(code, &p, &l) && size >= (l + 1) * 4) {
            uint32_t n = word_at(list + off + 8 + l * 4), src = word_at(list + off + 8 + p * 4);
            if (n) copy(journal + blob, wire_address(src), n);
            copy(list + off + 8 + p * 4, &blob, 4); blob += (n + 3) & ~3u;
        }
        off += 8 + size;
    }
    journal_len += need; usage_add(&journal_use, u); gl_deferred_lists++;
    return 1;
}
/* Submit the journal into the current host frame, rebasing upload offsets to addresses first. */
static void journal_submit(void) {
    if (!journal_len) return;
    host_frame_sync();
    for (uint32_t off = 0; off < journal_len;) {
        uint32_t need, len; copy(&need, journal + off, 4); copy(&len, journal + off + 4, 4);
        uint8_t *list = journal + off + 8;
        for (uint32_t at = 16; at + 8 <= len;) {
            uint32_t code = list[at] | ((uint32_t)list[at + 1] << 8), size = word_at(list + at + 4), p, l;
            if (data_words(code, &p, &l) && size >= (l + 1) * 4) {
                uint32_t address = PTR(journal) + word_at(list + at + 8 + p * 4);
                copy(list + at + 8 + p * 4, &address, 4);
            }
            at += 8 + size;
        }
        uint32_t version = word_at(list + 4), count = word_at(list + 12);
        int32_t rc = bgt_submit_commands(list, len);
        if (rc != BGT_E_LIMIT) { gpu_usage_t u = measure(list, len, count, (uint16_t)(version >> 16)); usage_add(&frame_use, &u); }
        if (rc < 0) { fail(rc == BGT_E_LIMIT ? OOM : BAD_OP); gl_deferred_rejects++; }
        off += need;
    }
    journal_len = 0; journal_use = (gpu_usage_t){0};
}
/* Submit the journal before the next present (request result needed, journal full). */
static void journal_flush_early(void) {
    if (!journal_len) return;
    if (!in_hook && !journal_fits_frame()) { gl_deferred_yields++; w32_wait_transport(); return; } /* resume submits it */
    journal_submit(); exposed = 1;
}
/* Every host submission of the GL profile goes through here (header as bgt_cmd_submit_flags). */
static int32_t host_submit(bgt_cmdbuf_t *b, uint16_t flags) {
    if (b->error) { int32_t rc = b->error; bgt_cmd_reset(b); return rc; }
    if (!b->count) return BGT_OK;
    bgt__put32(b->buf, BGT_CMD_MAGIC);
    bgt__put32(b->buf + 4, BGT_CMD_VERSION | ((uint32_t)flags << 16));
    bgt__put32(b->buf + 8, b->len); bgt__put32(b->buf + 12, b->count);
    gpu_usage_t u = measure(b->buf, b->len, b->count, flags);
    usage_add(&guest_frame, &u);
    if (deferring && journal_add(b->buf, b->len, &u)) { bgt_cmd_reset(b); return BGT_OK; }
    const uint8_t *list = b->buf; uint32_t len = b->len; uint8_t *held = 0;
    if (journal_len && !in_hook && !journal_fits_frame() && (held = glp_alloc(len))) {
        /* The journal must reach the host first, in a new host frame. Hold a private copy of this
         * list across the yield (other guest threads may reuse the command buffer meanwhile). */
        copy(held, list, len); list = held; bgt_cmd_reset(b);
        gl_deferred_yields++; w32_wait_transport(); /* the resume hook submits the journal */
    } else if (journal_len) { journal_submit(); exposed = 1; }
    if (deferring) exposed = 1; /* post-present work that could not be journaled reaches this frame */
    host_frame_sync();
    int32_t rc = bgt_submit_commands(list, len);
    if (rc != BGT_E_LIMIT) usage_add(&frame_use, &u);
    if (held) glp_free(held, len); else bgt_cmd_reset(b);
    return rc;
}
/* Other submitters in the same host frame (GDI/legacy 2D lists) are charged here too. A legacy list
 * counts against the list allowance and the aggregate wire budget. The densest legacy command is CLEAR
 * (12 wire bytes, 6 vertices), so bytes/2 bounds its vertices. */
void w32_gl_charge_foreign(uint32_t bytes, uint32_t commands) {
    host_frame_sync();
    gpu_usage_t u = {bytes, commands, 1, 0, bytes / 2};
    usage_add(&frame_use, &u);
}
/* A request result is only visible once its list reached the host. */
static int32_t request_status(uint32_t id) { journal_flush_early(); return bgt_request_status(id); }
static int next_frame_fits(void) {
    gpu_usage_t m = {0};
    for (uint32_t i = 0; i < 4; i++) {
        const gpu_usage_t *r = &recent_frames[i];
#define KEEP_MAX(f) m.f = r->f > m.f ? r->f : m.f
        KEEP_MAX(bytes); KEEP_MAX(commands); KEEP_MAX(lists); KEEP_MAX(uploads); KEEP_MAX(vertices);
#undef KEEP_MAX
    }
    host_frame_sync();
    return fits(&frame_use, &m);
}
/* Interval-0 SwapBuffers: the finished frame reaches the host before the update decision, unless
 * its measured cost no longer fits this host frame: then the update ends first and the frame is
 * submitted at the start of the next one (the previous presented image stays shown). */
static void present_interval0(void) {
    flush_pending(); /* I17: the frame's batched lists are measured into guest_frame before the decision */
    int fit = journal_fits_frame();
    if (fit) journal_submit();
    exposed = 0;
    for (uint32_t i = 3; i; i--) recent_frames[i] = recent_frames[i - 1];
    recent_frames[0] = guest_frame; guest_frame = (gpu_usage_t){0};
    w32_guest_present(1);
    deferring = !w32_clock_swap0(!fit || !next_frame_fits());
}
void w32_gl_host_yield(int resume) {
    if (!resume) { if (exposed) gl_torn_frames++; exposed = 0; return; }
    deferring = 0; in_hook = 1; journal_submit(); in_hook = 0;
}
uint64_t w32_gl_deferred_yields(void) { return gl_deferred_yields; }
uint64_t w32_gl_torn_frames(void) { return gl_torn_frames; }
uint64_t w32_gl_deferred_lists(void) { return gl_deferred_lists; }
uint64_t w32_gl_deferred_rejects(void) { return gl_deferred_rejects; }
/* K53 frame batching. GPU-only lists whose acceptance changes no profile bookkeeping (pass/draw
 * lists, clears, BUFFER_UPDATE and TEXTURE_UPDATE uploads) are appended to one pending list and
 * submitted at a sync point: any synchronous submission (creates/deletes/readback/requests/
 * feedback), SwapBuffers/any host yield, GDI flush, glGetError/glFinish, a guest error, or the
 * size bounds below. Stream order is unchanged; only the wire-list boundaries move. Upload bytes
 * are copied into a batch-owned arena (the ABI copies at submit, guest/profile memory may change
 * before the flush).
 * Acceptance stays exact: the ABI rejects a whole list with no effects, so a rejected batch is
 * replayed as its original per-call lists, in order. Each call is then accepted or rejected as
 * the per-call path would have done (first rejection latches OOM for E_LIMIT, otherwise
 * INVALID_OPERATION), a draw whose deferred uniform upload was rejected is skipped as the per-call
 * path never emitted it, and the journal restores profile state the call committed on deferral
 * (buffer shadow bytes/generation, uniform dirtiness, draw count). */
uint64_t w32_gl_batched_lists, w32_gl_batch_flushes, w32_gl_sync_submits, w32_gl_batch_replays;
static int submit(void);
enum { PR_NONE, PR_BYTES, PR_UBO, PR_DRAW, PR_RELEASE, PR_CREATE };
/* One deferred call: its byte range in the pending list and what it committed on deferral.
 * K57: PR_BYTES may also carry a logical size change (capacity reuse: size_old -> size_new, `resize`)
 * and writes into `dst`, the shadow block current at the call (a later deferred reallocation of the
 * same buffer retires that block only after the batch). PR_RELEASE/PR_CREATE are the wire DELETE and
 * CREATE of a buffer reallocation (`handle`, buffer slot `obj`, capacity `cap`, logical size `n`).
 * A PR_DRAW under transform feedback keeps what its capture committed (cursor advance, generated
 * provenance, primitives-written query) so a replayed rejection can withdraw it. */
typedef struct {
    uint64_t seq, dep_seq; uint32_t start, end, kind, obj, off, n; uint8_t gen_old, gen_clear; uint8_t *old, *src;
    uint8_t *dst; uint32_t size_old, size_new, handle, cap; uint8_t resize, tf_n, tf_gen[4];
    uint32_t tf_obj[4], tf_add[4], tf_query, tf_prims;
} PendRec;
static PendRec *pend_last;          /* record of the latest deferred call; NULL when it was submitted synchronously */
static uint64_t pend_dep_seq;       /* set by draw(): the next list depends on this record's acceptance */
static uint64_t pend_rejected_seq;  /* most recent record rejected by a replay */
static uint32_t replay_error;       /* error a replay newly latched (callers that restore the latch reset it first) */
#ifndef W32_GL_SYNC_SUBMIT
#define W32_GL_SYNC_SUBMIT 0
#endif
#if UINTPTR_MAX > 0xffffffffu || W32_GL_SYNC_SUBMIT
/* Native 64-bit test hosts cannot express owned wire pointers; they keep per-call submission,
 * as does the BGT_GL_SYNC_SUBMIT=1 A/B build (tools/build/pipeline.mjs). */
static void flush_pending(void) {}
static int fail_deferred(uint32_t e) { (void)e; return 0; }
void w32_gl_flush(void) {}
static void retire_block(uint8_t *p, uint32_t n) { if (p) glp_free(p, n); }
static int submit_deferred_x(uint32_t reserve) { (void)reserve; pend_last = 0; return submit(); }
#else
/* Journal effects for a replayed batch, after the Buffer/Program types: undo (newest-first, back to the
 * pre-batch state), redo (oldest-first, accepted calls only), reject (rejected calls), fixup (after both). */
static void pend_undo(PendRec *r);
static void pend_redo(PendRec *r);
static void pend_reject(PendRec *r);
static void pend_fixup(PendRec *r, int accepted);
#define PEND_BYTES (256u * 1024u)
#define PEND_DATA (1024u * 1024u)
static uint32_t pend_mem[PEND_BYTES / 4];
static uint8_t pend_data[PEND_DATA] __attribute__((aligned(16)));
static bgt_cmdbuf_t pend; static uint32_t pend_ready, pend_used, nrecs;
static PendRec recs[4096]; static uint64_t pend_seq;
static uint32_t replay_mem[PEND_BYTES / 16 + 64];
static uint8_t replay_ok[4096];
/* K57: shadow blocks replaced by a deferred reallocation stay allocated until the batch is settled. */
static struct { uint8_t *p; uint32_t n; } pend_retired[4096]; static uint32_t pend_nretired;
/* K57: the decoder skips only a failing command (§6 execution pass); a list is rejected with no effects
 * only before that pass (framing, aggregate wire budget). bgt_submit_failures tells which: per-command
 * failures settle the journal from the failed command offsets (no resubmission: every other command already
 * took effect, exactly as its per-call list would have); a list rejected whole is replayed per call. */
static uint32_t replay_failed[2 * 4096];
static int pend_flushing;
static uint32_t err_seq_valid; static uint64_t err_seq; /* K60: see fail() */
/* K60: see fail(). Returns 1 when the error was latched without a flush. */
static int fail_deferred(uint32_t e) {
    if (!nrecs || pend_flushing || latch_local) return 0;
    if (!error && !latch_outer && !err_seq_valid) { err_seq = pend_seq; err_seq_valid = 1; }
    if (!error) error = e;
    return 1;
}
/* The first failed deferred call of a settled batch (stream order): if it precedes a latched validation error
 * raised while it was pending, its error is the first one (glGetError reports latch_fix). */
static void replay_first(const PendRec *r, uint32_t code) {
    if (err_seq_valid && r->seq <= err_seq && !latch_fix) latch_fix = code;
}
static void replay_whole(void) {
    int first = 0;
    for (uint32_t i = 0; i < nrecs; i++) {
        PendRec *r = &recs[i]; int dead = 0;
        if (r->dep_seq) for (uint32_t j = i; j-- > 0;) if (recs[j].seq == r->dep_seq) { dead = !replay_ok[j]; break; }
        if (dead) { replay_ok[i] = 0; continue; }
        bgt_cmdbuf_t one; bgt_cmd_init(&one, replay_mem, sizeof replay_mem);
        for (uint32_t off = r->start; off < r->end;) {
            uint32_t code = pend.buf[off] | ((uint32_t)pend.buf[off + 1] << 8), size;
            copy(&size, pend.buf + off + 4, 4);
            __builtin_memcpy(bgt_cmd_push(&one, (uint16_t)code, size), pend.buf + off + 8, size);
            off += 8 + size;
        }
        int32_t rc = host_submit(&one, BGT_CMD_GPU_CONTINUATION); /* I17: charged/journaled like any list */
        /* A reallocation's headroom is never the reason for GL_OUT_OF_MEMORY: retry it at the exact size. */
        if (rc < 0 && r->kind == PR_CREATE && r->cap > r->n) {
            bgt_cmd_init(&one, replay_mem, sizeof replay_mem);
            uint8_t *w = bgt_cmd_push(&one, 0x40, 20); __builtin_memcpy(w, pend.buf + r->start + 8, 20);
            copy(w + 8, &r->n, 4); copy(w + 16, &r->n, 4);
            rc = host_submit(&one, BGT_CMD_GPU_CONTINUATION);
            if (rc >= 0) r->cap = r->n;
        }
        replay_ok[i] = rc >= 0;
        if (rc < 0 && !first) { first = 1; replay_first(r, rc == -3 ? OOM : BAD_OP); }
        if (rc < 0 && !error) error = rc == -3 ? OOM : BAD_OP;
    }
}
static void replay(void) {
    w32_gl_batch_replays++; uint32_t latched = error;
    int32_t failed = bgt_submit_failures(replay_failed, 4096);
    if (failed < 0 || failed > 4096) replay_whole();
    else {
        for (uint32_t i = 0; i < nrecs; i++) replay_ok[i] = 1;
        for (int32_t k = 0, r = 0; k < failed; k++) {
            uint32_t at = replay_failed[2 * k]; int32_t code = (int32_t)replay_failed[2 * k + 1];
            if (!error) error = code == -3 ? OOM : BAD_OP; /* first failed command in stream order */
            while (r < (int32_t)nrecs && recs[r].end <= at) r++;
            if (r < (int32_t)nrecs && recs[r].start <= at) {
                if (!k) replay_first(&recs[r], code == -3 ? OOM : BAD_OP);
                replay_ok[r] = 0;
            }
        }
    }
    /* Profile state: back to the pre-batch state, then forward through the accepted calls only. */
    for (uint32_t i = nrecs; i-- > 0;) pend_undo(&recs[i]);
    for (uint32_t i = 0; i < nrecs; i++) {
        if (replay_ok[i]) pend_redo(&recs[i]);
        else { pend_reject(&recs[i]); pend_rejected_seq = recs[i].seq; }
    }
    for (uint32_t i = 0; i < nrecs; i++) pend_fixup(&recs[i], replay_ok[i]);
    if (!latched && error) replay_error = error;
}
/* I17 (K50 x K53): the batch is one more list on K50's single host-submission path. host_submit
 * charges it to the host frame budgets and, while post-present work is deferred, journals it in
 * stream order behind earlier deferred lists, so the batch and the journal are one ordered queue:
 * pend -> host_submit -> (journal | host frame). host_submit can yield (a journal that no longer fits
 * the host frame goes first, in a new one); wait_host and fail() reach flush_pending again from
 * there, so a flush in progress is not re-entered. The list bytes stay in pend_mem (reset only
 * rewinds the cursor) for a replay. A journaled batch reports success; a later host rejection of it
 * is K50's late deferred error (deferred_gl_rejects), not a per-call replay. */
static void flush_pending(void) {
    if (pend_flushing) return;
    pend_last = 0;
    if (!pend_ready || !pend.count) {
        nrecs = 0; err_seq_valid = 0;
        for (uint32_t i = 0; i < pend_nretired; i++) glp_free(pend_retired[i].p, pend_retired[i].n);
        pend_nretired = 0; return;
    }
    pend_flushing = 1;
    int32_t rc = host_submit(&pend, BGT_CMD_GPU_CONTINUATION);
    w32_gl_batch_flushes++;
    if (rc < 0) replay();
    pend_flushing = 0;
    bgt_cmd_reset(&pend); pend_used = 0; nrecs = 0;
    err_seq_valid = 0; /* every deferred call is settled: a latched error now precedes all later ones */
    for (uint32_t i = 0; i < pend_nretired; i++) glp_free(pend_retired[i].p, pend_retired[i].n);
    pend_nretired = 0;
}
/* A shadow block replaced while calls of this batch may still reference it (journal undo/redo). */
static void retire_block(uint8_t *p, uint32_t n) {
    if (!p) return;
    if (!nrecs) { glp_free(p, n); return; }
    if (pend_nretired == sizeof pend_retired / sizeof pend_retired[0]) flush_pending();
    if (!nrecs) { glp_free(p, n); return; }
    pend_retired[pend_nretired].p = p; pend_retired[pend_nretired].n = n; pend_nretired++;
}
void w32_gl_flush(void) { flush_pending(); }
/* Data pointer/length word indices of the deferrable upload opcodes. */
static int data_field(uint32_t code, uint32_t *ptr, uint32_t *len) {
    switch (code) {
    case 0x41: *ptr = 2; *len = 3; return 1;
    case 0x44: *ptr = 6; *len = 7; return 1;
    case 0x5a: *ptr = 8; *len = 9; return 1;
    default: return 0;
    }
}
/* Defers the list in `cmd` (or submits it synchronously when it cannot be deferred: pend_last is
 * then NULL). `reserve` arena bytes are kept at pend_last->old for the caller's journal. */
static int submit_deferred_x(uint32_t reserve) {
    pend_last = 0;
    if (cmd.error || !cmd.count) return submit();
    uint32_t data = 0;
    for (uint32_t off = 16; off < cmd.len;) {
        uint32_t code = cmd.buf[off] | ((uint32_t)cmd.buf[off + 1] << 8), size, pi, li, n;
        copy(&size, cmd.buf + off + 4, 4);
        if (code < 0x40 || code > 0x64) return submit(); /* K57: feedback captures (0x62) batch too */
        if (data_field(code, &pi, &li)) { copy(&n, cmd.buf + off + 8 + li * 4, 4); data += (n + 15u) & ~15u; }
        off += 8 + size;
    }
    data += (reserve + 15u) & ~15u;
    if (data > PEND_DATA / 4 || cmd.len - 16 > PEND_BYTES / 4) return submit();
    /* A dependency marker belongs to this list only: consume it on every early exit too. */
    if (!flush_padded_cleanup()) { pend_dep_seq = 0; bgt_cmd_reset(&cmd); return 0; }
    if (!pend_ready) { bgt_cmd_init(&pend, pend_mem, sizeof pend_mem); pend_ready = 1; }
    if (pend.len + cmd.len - 16 > pend.cap || pend.count + cmd.count > 4096u || pend_used + data > PEND_DATA) {
        flush_pending();
        if (pend_dep_seq && pend_rejected_seq == pend_dep_seq) { pend_dep_seq = 0; bgt_cmd_reset(&cmd); return 0; }
    }
    /* K57: a call that depends on the immediately preceding deferred call (a draw on its uniform upload, a
     * reallocation's CREATE on its DELETE) is chained to it with BGT_CMD_FLAG_IF_HEAD: if the head command fails
     * inside the batch, the host skips the dependent commands, as the unbatched path would never have sent them. */
    int chained = pend_dep_seq && nrecs && recs[nrecs - 1].seq == pend_dep_seq && recs[nrecs - 1].end - recs[nrecs - 1].start >= 8;
    PendRec *r = &recs[nrecs++];
    *r = (PendRec){.seq = ++pend_seq, .dep_seq = pend_dep_seq, .start = pend.len};
    pend_dep_seq = 0;
    for (uint32_t off = 16; off < cmd.len;) {
        uint32_t code = cmd.buf[off] | ((uint32_t)cmd.buf[off + 1] << 8), size, pi, li;
        copy(&size, cmd.buf + off + 4, 4);
        uint8_t *payload = bgt_cmd_push(&pend, code, size);
        if (chained && payload) payload[-6] = (uint8_t)BGT_CMD_FLAG_IF_HEAD;
        __builtin_memcpy(payload, cmd.buf + off + 8, size);
        if (data_field(code, &pi, &li)) {
            uint32_t src, n; copy(&src, payload + pi * 4, 4); copy(&n, payload + li * 4, 4);
            uint8_t *dst = pend_data + pend_used;
            if (n) __builtin_memcpy(dst, (const void *)(uintptr_t)src, n);
            uint32_t at = PTR(dst); copy(payload + pi * 4, &at, 4); pend_used += (n + 15u) & ~15u;
            r->src = dst;
        }
        off += 8 + size;
    }
    r->end = pend.len;
    if (reserve) { r->old = pend_data + pend_used; pend_used += (reserve + 15u) & ~15u; }
    bgt_cmd_reset(&cmd); w32_gl_batched_lists++; pend_last = r;
    return 1;
}
#endif
static int submit_deferred(void) { return submit_deferred_x(0); }
/* K57 capacity budget (see buffer_store): retained slack, reclaim guard, last synchronous submit result. */
static uint64_t buffer_slack;
static uint32_t reclaiming;
static int32_t last_submit_rc;
uint64_t w32_gl_reclaim_retries;
static void reclaim_slack(void);
static int submit(void) {
    last_submit_rc = 0;
    flush_pending();
    if (pend_dep_seq) { /* draw() after a deferred uniform upload that the flush just rejected */
        int dead = pend_rejected_seq == pend_dep_seq; pend_dep_seq = 0;
        if (dead) { bgt_cmd_reset(&cmd); return 0; }
    }
    w32_gl_sync_submits++;
    if (!flush_padded_cleanup()) { bgt_cmd_reset(&cmd); return 0; }
    /* Keep immediate validation/owned uploads and exact ordering. Only GPU-only lists opt into
     * §13.12's bounded aggregate budget; legacy screen readback retains its frozen header. */
    uint16_t flags = BGT_CMD_GPU_CONTINUATION;
    for (uint32_t off = 16; off < cmd.len;) {
        uint32_t code = cmd.buf[off] | ((uint32_t)cmd.buf[off + 1] << 8), size;
        copy(&size, cmd.buf + off + 4, 4);
        if (code < 0x40 || code > 0x64) flags = 0;
        off += 8 + size;
    }
    /* K57 review: one allocating command (buffer/texture/shader creation, mip allocation) rejected for the budget
     * while capacity slack is retained reclaims the slack and is retried once: capacity reuse never causes a
     * GL_OUT_OF_MEMORY the exact-size profile would not raise. A single command takes effect whole or not at all. */
    uint32_t saved[64], saved_code = 0, saved_size = 0;
    if (buffer_slack && !reclaiming && cmd.count == 1 && cmd.len <= 16 + 8 + sizeof saved) {
        uint32_t code = cmd.buf[16] | ((uint32_t)cmd.buf[17] << 8), size; copy(&size, cmd.buf + 20, 4);
        if ((code == 0x40 || code == 0x43 || code == 0x48 || code == 0x59 || code == 0x5a || code == 0x5d || code == 0x5e) &&
            size <= sizeof saved) { saved_code = code; saved_size = size; copy(saved, cmd.buf + 24, size); }
    }
    int32_t rc = host_submit(&cmd, flags);
    if (rc == BGT_E_LIMIT && saved_code) {
        reclaim_slack(); w32_gl_reclaim_retries++;
        begin(); op(saved_code, saved, saved_size / 4); rc = host_submit(&cmd, flags);
    }
    last_submit_rc = rc;
    if (rc < 0) { fail(rc == -3 ? OOM : BAD_OP); return 0; }
    return 1;
}
/* Track accepted wire generations, including private resources. Private reservations are kept
 * even while unmaterialized: textures900..921; buffers1000..1006 and1023. */
static uint8_t gpu_texture[N], gpu_buffer_initial[N], gpu_shader[N], gpu_pipeline[N];
static uint8_t *gpu_buffer = gpu_buffer_initial;
static uint32_t buffer_wire_slots = N, buffer_handles_enabled, buffer_next_free = 1;
static int send(uint32_t code, const uint32_t *w, uint32_t n) {
    begin(); op(code, w, n); int ok = submit();
    if (ok && n && w[0] && w[0] < buffer_wire_slots && (code == 0x40 || code == 0x42)) {
        gpu_buffer[w[0]] = code == 0x40;
        if (code == 0x42 && w[0] < buffer_next_free) buffer_next_free = w[0];
    }
    if (ok && n && w[0] && w[0] < N) {
        if (code == 0x43 || code == 0x59 || code == 0x45) gpu_texture[w[0]] = code != 0x45;
        if (code == 0x48 || code == 0x49) gpu_shader[w[0]] = code == 0x48;
        if (code == 0x4a || code == 0x4b) gpu_pipeline[w[0]] = code == 0x4a;
    }
    return ok;
}
#define SEND(code, ...) do { \
    const uint32_t payload[] = {__VA_ARGS__}; send(code, payload, sizeof payload / 4); \
} while (0)
/* Deferred upload: result is acceptance into the ordered batch (see submit_deferred). */
static int send_deferred(uint32_t code, const uint32_t *w, uint32_t n) { begin(); op(code, w, n); return submit_deferred(); }
/* Deferred buffer upload whose shadow write the journal can undo: call before changing b->data. */
static int send_deferred_bytes(uint32_t code, const uint32_t *w, uint32_t n, uint32_t old_bytes) {
    begin(); op(code, w, n); return submit_deferred_x(old_bytes);
}
#define SEND_DEFERRED(code, ...) do { \
    const uint32_t payload[] = {__VA_ARGS__}; send_deferred(code, payload, sizeof payload / 4); \
} while (0)
static int wait_request(uint32_t id, char *log, uint32_t cap) {
    int status;
    while ((status = request_status(id)) == 0) w32_wait_transport();
    uint8_t result[4096] = {0};
    int n = status > 0 ? bgt_request_read(id, result, sizeof result) : status;
    bgt_request_close(id);
    int code = -1;
    if (n >= 4) { copy(&code, result, 4); n -= 4; }
    else n = 0;
    uint32_t k = (uint32_t)n < cap - 1 ? (uint32_t)n : cap - 1;
    copy(log, result + 4, k); log[k] = 0;
    if (code && !k) { const char *s = "BGT GPU unavailable or shader compilation failed";
        k = w32_slen(s); if (k >= cap) k = cap - 1; copy(log, s, k); log[k] = 0; }
    return code == 0;
}
int w32_gl_active(void) { return current != 0; }
const char *w32_gl_stubs_json(void) { return stub_json; }
static void missing(const char *name) {
    w32_gl_unimplemented++;
    uint32_t n = w32_slen(name);
    if (stub_len + n + 5 < sizeof stub_json) {
        if (stub_len > 1) stub_json[stub_len++] = ',';
        stub_json[stub_len++] = '"'; copy(stub_json + stub_len, name, n); stub_len += n;
        stub_json[stub_len++] = '"'; stub_json[stub_len] = ']'; stub_json[stub_len + 1] = 0;
    }
    w32_logf2("unimplemented OpenGL entry: ", name);
}

typedef struct { uint32_t used, size, gpu, generated; uint8_t *data;
    uint32_t map, map_offset, map_size, map_flags, map_access, bound, vao_refs, collect_next, collect_queued;
    uint32_t cap; /* K57: native store/shadow capacity (>= size), accounted in buffer_slack */ } Buffer;
static void approximate(const char *kind);
static void unmap_storage(Buffer *b);
typedef struct { uint32_t enabled, buffer, count, type, normalized, stride, offset, divisor, integer; } Attribute;
typedef struct { uint32_t used, element, bound; Attribute a[16]; } Vao;
#include "w32_gl_program.h" /* K6b frontend; K6a texture/FBO objects live in their own headers. */
static Buffer buffers_initial[N]; static Vao vaos_initial[N];
static Buffer *buffers = buffers_initial; static Vao *vaos = vaos_initial;
static uint32_t buffer_slots = N, vao_slots = N;
#define BN buffer_slots
#define VN vao_slots
/* K60: each program's private uniform buffer has GL_UBO_TAIL bytes after its uniform values (usage
 * uniform|vertex). A single-instance draw that reads generic current attributes (disabled arrays) carries
 * them there, in the same batched BUFFER_UPDATE as its uniform values, and binds its constant vertex slot to
 * that tail: no separate (synchronous) current-attribute upload, and the draw depends on one upload. */
#define GL_UBO_TAIL 256u
/* K60: the private uniform buffer is a ring of slots (values + tail, 256-aligned); each draw uploads into the
 * next slot and binds it, so consecutive draws of one program write disjoint bytes and a WebGPU frame encoder
 * that still reads the previous slot needs no copy-on-write rename. At most 16 slots and 32 KiB per program. */
static uint32_t ubo_stride(uint32_t usize) { return (usize + GL_UBO_TAIL + 255u) & ~255u; }
static uint32_t ubo_ring_slots(uint32_t usize) {
    uint32_t n = 32768u / ubo_stride(usize); return n < 1 ? 1 : n > 16 ? 16 : n;
}
/* Generic current values belong to the context, not the VAO (GL 3.3 §2.8). */
static float current_attr[16][4]; static uint32_t current_attr_ready;
static void init_current_attr(void) {
    if (!current_attr_ready) { for (uint32_t i = 0; i < 16; i++) current_attr[i][3] = 1; current_attr_ready = 1; }
}
static uint32_t current_attribute(uint32_t n, int vector) {
    uint32_t index = ARG(0); if (index >= 16) { fail(BAD_VALUE); return 0; }
    init_current_attr();
    for (uint32_t i = 0; i < 4; i++) {
        union { uint32_t u; float f; } v = {vector && i < n ? x86_rd32(ARG(1) + 4 * i) : 0};
        current_attr[index][i] = i < n ? (vector ? v.f : argf(i + 1)) : i == 3 ? 1.0f : 0.0f;
    }
    return 0;
}
#define CURRENT_ATTR(n) \
    static uint32_t api_VertexAttrib##n##f(void) { return current_attribute(n, 0); } \
    static uint32_t api_VertexAttrib##n##fv(void) { return current_attribute(n, 1); }
CURRENT_ATTR(1) CURRENT_ATTR(2) CURRENT_ATTR(3) CURRENT_ATTR(4)
#undef CURRENT_ATTR
static Shader shaders[N]; static Program programs[N];
/* K62: GL 3.3 minimums: 36 uniform-buffer binding points, 48 combined texture image units (profile state; a program
 * still maps at most 7 blocks and 8 sampler slots onto §13's 8 + 8 per-pipeline slots). */
#define GL_UBO_BINDINGS 36
#define GL_TEXTURE_UNITS 48
static uint32_t vao, array, uniform, ubo[GL_UBO_BINDINGS], ubo_offset[GL_UBO_BINDINGS], ubo_size[GL_UBO_BINDINGS], active_unit, samp[GL_TEXTURE_UNITS];
static uint32_t current_gpu, current_capacity; static uint32_t *current_data;
static uint32_t ubo_whole[GL_UBO_BINDINGS], padded_ubo[7], padded_ubo_size[7], padded_generated[7], padded_cleanup[7];
/* Retire generated private temporaries even when materialization or a later submission fails.
 * If the aggregate wire budget is exhausted, retry before the next public submission: a source
 * cannot be successfully deleted/reuploaded while an inaccessible generated temporary remains. */
static int flush_padded_cleanup(void) {
    uint32_t storage[25]; bgt_cmdbuf_t cleanup; bgt_cmd_init(&cleanup, storage, sizeof storage);
    for (uint32_t i = 0; i < 7; i++) if (padded_cleanup[i]) {
        uint8_t *payload = bgt_cmd_push(&cleanup, 0x42, 4); bgt__gpu_copy(payload, &padded_ubo[i], 4);
    }
    if (!cleanup.count) return 1;
    flush_pending(); /* deferred draws may still reference the retired temporaries */
    int32_t rc = host_submit(&cleanup, BGT_CMD_GPU_CONTINUATION);
    if (rc < 0) { fail(rc == -3 ? OOM : BAD_OP); return 0; }
    for (uint32_t i = 0; i < 7; i++) if (padded_cleanup[i])
        padded_ubo[i] = padded_ubo_size[i] = padded_generated[i] = padded_cleanup[i] = 0;
    return 1;
}
static void retire_generated_ubos(void) {
    for (uint32_t i = 0; i < 7; i++) if (padded_generated[i]) padded_cleanup[i] = 1;
    flush_padded_cleanup();
}
static uint32_t copy_read, copy_write, pixel_pack, pixel_unpack, texture_buffer;
static uint32_t program;
static uint32_t tf_buffer, tf_active, tf_mode, rasterizer_discard;
static uint32_t tf_bound[4], tf_offset[4], tf_size[4], tf_whole[4], tf_cursor[4];
typedef struct { uint32_t used, target, active, result; } GlQuery;
static GlQuery gl_queries[N]; static uint32_t tf_query;
static uint32_t blend, depth, stencil, cull, scissor_enabled;
static uint32_t cull_face = 2, front_face, depth_write = 1, depth_compare = 1;
static uint32_t src_rgb = 1, dst_rgb, src_alpha = 1, dst_alpha, blend_op_rgb, blend_op_alpha;
static uint32_t stencil_compare = 7, stencil_read = 255, stencil_write = 255, stencil_ref;
static uint32_t stencil_fail, stencil_zfail, stencil_pass, color_mask = 15, color_masks[4] = {15, 15, 15, 15};
/* K61: back-face stencil state (glStencil*Separate). Compare/ops are per face in §13 pipelines; reference and
 * masks have one value per pipeline/pass, so a back value that differs from the front one is an approximation. */
static uint32_t back_compare = 7, back_fail, back_zfail, back_pass, back_read = 255, back_write = 255, back_ref;
static float clear_color[4], clear_depth = 1, blend_color[4]; static uint32_t clear_stencil;
static int32_t viewport[4], scissor[4]; static float range_min, range_max = 1;
typedef struct { uint32_t used, n, words[200], id, hash; } Pipeline;
static Pipeline pipelines[128]; static uint32_t pipeline_count;
/* Retired buffers enter a work list only on deletion or the final VAO detach.
 * A retained generation does not cause a capacity scan on every unrelated GL call. */
static uint32_t retired_buffer_head, image_collection_dirty;
static void queue_retired_buffer(uint32_t slot) {
    if (!buffers[slot].collect_queued) {
        buffers[slot].collect_next = retired_buffer_head; buffers[slot].collect_queued = 1;
        retired_buffer_head = slot;
    }
}
#include "w32_gl_names.h"
static void buffer_unref(uint32_t slot) {
    if (slot && !--buffers[slot].vao_refs && gl_retired && OBJECTS(buffers)->retired[slot]) queue_retired_buffer(slot);
}
/* Abandoned wire generations stay occupied until their destroy is accepted. This also
 * covers relink snapshots which no longer have a guest object owner. */
static uint8_t abandoned_buffer_initial[N], abandoned_shader[N], abandoned_pipeline[N];
static uint8_t *abandoned_buffer = abandoned_buffer_initial;
static uint32_t abandoned_buffers, abandoned_shaders, abandoned_pipelines;
static int cleanup_send(const char *kind, uint32_t code, uint32_t handle) {
    flush_pending(); uint32_t pending = error; error = 0; latch_local++; int ok = send(code, &handle, 1); latch_local--;
    if (!ok && error == OOM) object_exhaustion(kind, "GPU resource retirement budget", 1);
    if (pending) error = pending;
    return ok;
}
static void release_wire(uint32_t code, uint32_t handle, const char *kind) {
    if (!handle) return;
    uint8_t *pending = code == 0x42 ? abandoned_buffer : code == 0x49 ? abandoned_shader : abandoned_pipeline;
    uint32_t *count = code == 0x42 ? &abandoned_buffers : code == 0x49 ? &abandoned_shaders : &abandoned_pipelines;
    if (pending[handle]) (*count)--;
    pending[handle] = cleanup_send(kind, code, handle) ? 0 : eq(kind, "shaders") ? 1 : 2;
    if (pending[handle]) (*count)++;
}
static void collect_wire(void) {
    for (uint32_t h = 1; abandoned_buffers && h < buffer_wire_slots; h++)
        if ((GL_WORK(), abandoned_buffer[h]) && cleanup_send("programs", 0x42, h)) { abandoned_buffer[h] = 0; abandoned_buffers--; }
    for (uint32_t h = 1; (abandoned_shaders || abandoned_pipelines) && h < N; h++) {
        GL_WORK();
        if (abandoned_shader[h] && cleanup_send(abandoned_shader[h] == 1 ? "shaders" : "programs", 0x49, h)) { abandoned_shader[h] = 0; abandoned_shaders--; }
        if (abandoned_pipeline[h] && cleanup_send("programs", 0x4b, h)) { abandoned_pipeline[h] = 0; abandoned_pipelines--; }
    }
}
static uint32_t buffer_handle(uint32_t preferred, const char *kind) {
    if (preferred && preferred <= GPU_MAX && !(preferred >= 1000 && preferred <= 1006) &&
        preferred != 1023 && !gpu_buffer[preferred]) return preferred;
    /* Lowest-free high-water cursor: identical handle choices, but each occupied
     * entry is skipped once, not once per creation (quadratic at game scale).
     * Only an accepted destroy rewinds it; failed creates remain retryable. */
    uint32_t limit = buffer_handles_enabled ? buffer_wire_slots : N;
    while (buffer_next_free < limit && (gpu_buffer[buffer_next_free] ||
        (buffer_next_free >= 1000 && buffer_next_free <= 1006) || buffer_next_free == 1023)) {
        GL_WORK(); buffer_next_free++;
    }
    if (buffer_next_free < limit) return buffer_next_free;
    if (buffer_handles_enabled) {
        if (buffer_wire_slots <= UINT32_MAX / 4u) {
            uint32_t cap = buffer_wire_slots * 2u;
            uint8_t *p = glp_alloc(cap * 2u);
            if (p) {
                zero(p, cap * 2u); copy(p, gpu_buffer, buffer_wire_slots);
                copy(p + cap, abandoned_buffer, buffer_wire_slots);
                if (gpu_buffer != gpu_buffer_initial) glp_free(gpu_buffer, buffer_wire_slots * 2u);
                uint32_t h = buffer_wire_slots; gpu_buffer = p; abandoned_buffer = p + cap; buffer_wire_slots = cap; return h;
            }
        }
        object_exhaustion(kind, "GPU buffer ownership memory", 1); return 0;
    }
    object_exhaustion(kind, "GPU buffer handles (capability not negotiated)", 1); return 0;
}
static Buffer *bound_buffer(uint32_t target) {
    uint32_t id = target == ARRAY_BUFFER ? array : target == ELEMENT_BUFFER ? vaos[vao].element :
        target == UNIFORM_BUFFER ? uniform : target == FEEDBACK_BUFFER ? tf_buffer :
        target == 0x8f36 ? copy_read : target == 0x8f37 ? copy_write : target == 0x88eb ? pixel_pack :
        target == 0x88ec ? pixel_unpack : target == 0x8c2a ? texture_buffer : 0;
    if (target != ARRAY_BUFFER && target != ELEMENT_BUFFER && target != UNIFORM_BUFFER && target != FEEDBACK_BUFFER &&
        target != 0x8f36 && target != 0x8f37 && target != 0x88eb && target != 0x88ec && target != 0x8c2a) fail(BAD_ENUM);
    else if (!id || id >= BN || !buffers[id].used) fail(BAD_OP);
    return id && id < BN && buffers[id].used ? &buffers[id] : 0;
}
static uint32_t api_GenBuffers(void) {
    GEN_CHECK(buffers); int32_t n = (int32_t)ARG(0);
    for (int32_t i = 0; i < n; i++) x86_wr32(ARG(1) + 4 * i, NAME(buffers, alloc_name(buffers, sizeof(Buffer))));
    return 0;
}
/* Reviewer #136: Windows default-element storage survives even a core VAO-0 bind.
 * Only element state is VAO-owned; the other eight targets already work without a VAO.
 * Attribute setup and draws retain core errors: no supplied vendor evidence for those. */
static void default_element_compat(uint32_t target, const char *kind) {
    if (!vao && target == ELEMENT_BUFFER) approximate(kind);
}
static uint32_t api_BindBuffer(void) {
    uint32_t target = ARG(0), id = ARG(1);
    if (target != ARRAY_BUFFER && target != ELEMENT_BUFFER && target != UNIFORM_BUFFER && target != FEEDBACK_BUFFER &&
        target != 0x8f36 && target != 0x8f37 && target != 0x88eb && target != 0x88ec && target != 0x8c2a) { fail(BAD_ENUM); return 0; }
    id = BIND(buffers, id); if (id >= BN) return 0;
    if (id) buffers[id].bound = 1;
    if (target == ARRAY_BUFFER) array = id;
    else if (target == ELEMENT_BUFFER) {
        buffer_unref(vaos[vao].element);
        vaos[vao].element = id; if (id) buffers[id].vao_refs++;
    }
    else if (target == UNIFORM_BUFFER) uniform = id;
    else if (target == FEEDBACK_BUFFER) tf_buffer = id;
    else if (target == 0x8f36) copy_read = id;
    else if (target == 0x8f37) copy_write = id;
    else if (target == 0x88eb) pixel_pack = id;
    else if (target == 0x88ec) pixel_unpack = id;
    else if (target == 0x8c2a) texture_buffer = id;
    else { fail(target == ELEMENT_BUFFER ? BAD_OP : BAD_ENUM); return 0; }

    default_element_compat(target, "core VAO 0 element-buffer binding"); return 0;
}
/* K57 capacity reuse. b->size is the exact logical GL store (queries, bounds, mapping, feedback ranges,
 * binding sizes); b->cap is the live native store and of its CPU shadow block (b->data holds cap bytes).
 * glBufferData that fits the capacity rewrites the logical prefix with one BUFFER_UPDATE of the logical
 * size (the native tail beyond b->size is never observable: every native range the profile emits is
 * bounded by b->size). Retained capacity is budgeted: buffer_slack = sum(cap - size) over live stores
 * stays <= slack_max() (min(16 MiB, GPU budget / 16)); growth beyond the capacity reallocates once with
 * headroom (1.5x the old capacity, 16-byte rounded) only within that budget, and a store whose logical
 * size falls below a quarter of a large capacity, or whose shrink would exceed the budget, is reallocated
 * at the exact size. Resident host bytes therefore exceed the exact-size (base) bytes by at most the slack.
 * Exact GL_OUT_OF_MEMORY: a CREATE is deferred only while no slack is retained (then the host holds exactly
 * the base's bytes at that point of the stream, so a rejection is genuine); otherwise it is synchronous, and
 * a budget rejection first retries without headroom, then reclaims other stores' slack (exact-size
 * reallocation of CPU-authoritative stores) and retries, before latching GL_OUT_OF_MEMORY. A generated
 * (feedback-written) store with spare capacity whose whole logical store is rewritten from the CPU is
 * reallocated at the exact size, since the host clears generated provenance only for a whole-store write:
 * every upload stays the written/logical range. */
#define BUFFER_MAX 67108864u
#define BUFFER_SLACK_MAX (16u << 20)
#define BUFFER_RELEASE_MIN (64u << 10)
uint64_t w32_gl_buffer_capacity_reused, w32_gl_buffer_capacity_grown, w32_gl_buffer_capacity_released;
static uint64_t slack_max(void) { uint64_t m = upload_budget / 16; return m < BUFFER_SLACK_MAX ? m : BUFFER_SLACK_MAX; }
/* Every change of a buffer's logical size or capacity goes through here (slack accounting). */
static void store_size(Buffer *b, uint32_t size, uint32_t cap) {
    buffer_slack -= b->cap - b->size; b->size = size; b->cap = cap; buffer_slack += cap - size;
}
/* Rewrite the logical store in place (equal size or within capacity, never a generated store with spare
 * capacity). 1 = accepted, 0 = rejected (the caller reallocates). */
static int respec_in_place(Buffer *b, const uint8_t *data, uint32_t n) {
    /* Transport owns uploads in order: earlier draws still see the old bytes. A rejected UPDATE has no
     * emitted item/native side effect (decoder validates before emit). In that exceptional case the
     * caller restores the error latch and runs the delete/create path: its own acceptance decides both
     * state and guest error. An error latched by a replayed rejection of earlier deferred calls (a
     * flush inside the send) is not this call's own and survives the restore; flushing up front instead
     * would split every frame's batch here. */
    uint32_t pending = error, update[] = {b->gpu, 0, PTR(data), n}; replay_error = 0;
    int ok = send_deferred_bytes(0x41, update, 4, n);
    if (ok) {
        PendRec *r = pend_last;
        if (r) { /* deferred: rewrite the store in place so a replayed rejection can restore it */
            *r = (PendRec){.seq = r->seq, .dep_seq = r->dep_seq, .start = r->start, .end = r->end, .kind = PR_BYTES,
                .obj = (uint32_t)(b - buffers), .n = n, .gen_old = (uint8_t)b->generated, .gen_clear = 1,
                .old = r->old, .src = r->src, .dst = b->data, .size_old = b->size, .size_new = n, .resize = 1};
            copy(r->old, b->data, n);
        }
        __builtin_memcpy(b->data, data, n);
        unmap_storage(b); b->map_access = 0x88ba; b->generated = 0; store_size(b, n, b->cap);
    } else error = pending ? pending : replay_error;
    return ok;
}
/* An allocation was rejected while capacity slack is retained: give CPU-authoritative stores with slack an
 * exact-size store under the same handle (contents from the shadow; mapping, bindings and names unchanged).
 * The DELETE frees the capacity first, so the exact CREATE always fits the resident budget; the whole
 * sequence (DELETE, exact CREATE, and the fallback below) is checked against every per-frame budget before
 * it starts. Should the exact CREATE still be rejected, the old store is recreated from its shadow at its
 * old capacity (the bytes it just released), so no contents are lost. Generated stores keep their slack
 * (their contents are native-only). */
static void reclaim_slack(void) {
    flush_pending(); reclaiming = 1; latch_local++;
    for (uint32_t s = 1; s < BN && buffer_slack; s++) {
        Buffer *o = &buffers[s];
        if (!o->used || !o->gpu || !o->size || o->cap <= o->size || o->generated) continue;
        gpu_usage_t u = {3 * (16 + 8) + 4 + 2 * 20, 3, 0, (uint64_t)o->size + o->cap, 0}; /* DELETE, CREATE, fallback */
        host_frame_sync(); if (!fits(&frame_use, &u)) continue;
        uint8_t *exact = glp_alloc(o->size); if (!exact) break;
        copy(exact, o->data, o->size);
        uint32_t pending = error, h = o->gpu; error = 0;
        if (!send(0x42, &h, 1)) { error = pending; glp_free(exact, o->size); continue; } /* old store intact */
        uint32_t create[] = {h, 15, o->size, PTR(exact), o->size};
        if (send(0x40, create, 5)) {
            retire_block(o->data, o->cap); o->data = exact; store_size(o, o->size, o->size); w32_gl_buffer_capacity_released++;
        } else {
            glp_free(exact, o->size);
            uint32_t again[] = {h, 15, o->cap, PTR(o->data), o->cap};
            if (!send(0x40, again, 5)) { /* not expected: the budgets were checked above */
                unmap_storage(o); glp_free(o->data, o->cap); o->data = 0; store_size(o, 0, 0); o->gpu = 0;
                w32_log("GL capacity reclaim: store recreation rejected after its release");
            }
        }
        error = pending; /* reclaim is the profile's own work, never a guest error */
    }
    reclaiming = 0; latch_local--;
}
/* Replace b's store with a new native store of logical size n and capacity cap (`block`: cap owned bytes,
 * contents then a zero tail), as DELETE + one CREATE (a single command takes effect whole or not at all).
 * keep_map keeps a guest mapping (sub-data replacements); glBufferData resets it. 1 = done; 0 = the
 * DELETE was rejected (old store kept) or the CREATE was (store left empty, GL_OUT_OF_MEMORY latched). */
static int buffer_store(Buffer *b, uint8_t *block, uint32_t n, uint32_t cap, int keep_map) {
    uint32_t slot = (uint32_t)(b - buffers), id = b->gpu;
    if (id) {
        if (!send_deferred(0x42, &id, 1)) { glp_free(block, cap); return 0; }
        PendRec *r = pend_last;
        if (r) { r->kind = PR_RELEASE; r->obj = slot; r->handle = id; }
        if (id < buffer_wire_slots) { gpu_buffer[id] = 0; if (id < buffer_next_free) buffer_next_free = id; }
    }
    uint64_t release_seq = id && pend_last ? pend_last->seq : 0;
    if (!keep_map) { unmap_storage(b); b->map_access = 0x88ba; }
    retire_block(b->data, b->cap); b->data = 0;
    store_size(b, 0, 0); b->gpu = 0; b->generated = 0;
    id = buffer_handle(slot < 256 ? slot : 0, "buffers");
    if (!id) { glp_free(block, cap); return 0; }
    /* Reserve the handle across the CREATE: a slack reclaim inside submit() allocates handles too. */
    if (id < buffer_wire_slots) gpu_buffer[id] = 1;
    for (;;) {
        /* Synchronous while slack is retained (submit() then reclaims slack and retries once on a budget
         * rejection); batched only when the host holds exactly the exact-size bytes at this stream position. */
        int sync = cap != n || buffer_slack > 0;
        begin(); { uint32_t create[] = {id, 15, cap, PTR(block), cap}; op(0x40, create, 5); }
        pend_dep_seq = release_seq; /* a rejected DELETE never reaches its CREATE (unbatched order) */
        uint32_t pending = error; error = 0; replay_error = 0;
        latch_local++; int ok = sync ? submit() : submit_deferred(); latch_local--;
        uint32_t own = error; release_seq = 0;
        /* This call's own CREATE was rejected for the budget (independently of errors earlier deferred calls
         * latched in the same flush): the headroom alone is dropped and the CREATE retried at the exact size. */
        if (!ok && sync && last_submit_rc == BGT_E_LIMIT && cap != n) {
            error = pending ? pending : replay_error; /* keep only what earlier deferred calls latched */
            uint8_t *exact = glp_alloc(n);
            if (!exact) { fail(OOM); glp_free(block, cap); return 0; }
            copy(exact, block, n); glp_free(block, cap); block = exact; cap = n; continue;
        }
        error = pending ? pending : own;
        if (!ok) {
            if (id < buffer_wire_slots) { gpu_buffer[id] = 0; if (id < buffer_next_free) buffer_next_free = id; }
            if (own == OOM) object_exhaustion("buffers", "GPU byte/submission budget", 1);
            glp_free(block, cap); return 0;
        }
        break;
    }
    PendRec *r = pend_last;
    if (r) { r->kind = PR_CREATE; r->obj = slot; r->handle = id; r->cap = cap; r->n = n; }
    if (id < buffer_wire_slots) gpu_buffer[id] = 1;
    b->gpu = id; b->data = block; store_size(b, n, cap);
    return 1;
}
static uint32_t api_BufferData(void) {
    Buffer *b = bound_buffer(ARG(0)); int64_t size = (int64_t)ARG64(1);
    if (!b) return 0;
    if (size <= 0 || size > BUFFER_MAX) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(b - buffers)) { fail(BAD_OP); return 0; }
    uint32_t n = (uint32_t)size, id = b->gpu, old_size = b->size;
    uint8_t *data = guest(ARG(2), n); if (!data) return 0;
    int fallback = 0, release = 0;
    if (id && n <= b->cap) {
        uint64_t slack_after = buffer_slack - (b->cap - b->size) + (b->cap - n);
        if ((b->generated && n != b->cap) || slack_after > slack_max() || (n < b->cap / 4 && b->cap - n >= BUFFER_RELEASE_MIN))
            release = 1; /* exact-size reallocation releases the capacity */
        else if (respec_in_place(b, data, n)) {
            glp_free(data, n);
            if (n == old_size) w32_gl_buffer_respec_reused++;
            else {
                w32_gl_buffer_respec_resized++; w32_gl_buffer_capacity_reused++;
                if (n > old_size) w32_gl_buffer_respec_grew++; else w32_gl_buffer_respec_shrank++;
            }
            default_element_compat(ARG(0), "core VAO 0 element-buffer data upload"); return 0;
        } else fallback = 1; /* K47: a rejected in-place update reruns the exact delete/create path */
    }
    uint32_t cap = n;
    if (id && !fallback && !release && n > b->cap) {
        uint64_t grown = (uint64_t)b->cap + b->cap / 2;
        if (grown > n) {
            grown = (grown + 15) & ~15ull;
            if (grown > BUFFER_MAX) grown = BUFFER_MAX;
            if (buffer_slack - (b->cap - b->size) + (grown - n) <= slack_max()) cap = (uint32_t)grown;
        }
    }
    uint8_t *block = data;
    if (cap != n) {
        block = glp_alloc(cap);
        if (!block) cap = n, block = data;
        else { copy(block, data, n); zero(block + n, cap - n); glp_free(data, n); }
    }
    /* BufferData replaces the store and resets mapping state (GL3.3 table 2.10). */
    if (!buffer_store(b, block, n, cap, 0)) return 0;
    if (old_size && old_size != n) {
        w32_gl_buffer_respec_resized++;
        if (n > old_size) w32_gl_buffer_respec_grew++;
        else w32_gl_buffer_respec_shrank++;
    }
    if (old_size) { if (release) w32_gl_buffer_capacity_released++; else w32_gl_buffer_capacity_grown++; }
    default_element_compat(ARG(0), "core VAO 0 element-buffer data upload"); return 0;
}
static uint32_t api_BufferSubData(void) {
    Buffer *b = bound_buffer(ARG(0)); uint64_t off = ARG64(1), n = ARG64(2);
    if (!b) return 0;
    if (b->map) { fail(BAD_OP); return 0; }
    if (off + n < off || off + n > b->size) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(b - buffers)) { fail(BAD_OP); return 0; }
    if (b->generated && ((off & 3) || (n & 3)) && (off || n != b->size)) { fail(BAD_OP); return 0; }
    if (n) {
        uint32_t len = (uint32_t)n;
        uint8_t *data = glp_alloc(len); if (!data) { fail(OOM); return 0; }
        for (uint32_t i = 0; i < n; i++) data[i] = x86_rd8(ARG(3) + i);
        if (b->generated && !off && n == b->size && b->size != b->cap) {
            /* K57: CPU bytes replace a generated store with spare capacity: exact-size store (see buffer_store). */
            if (buffer_store(b, data, len, len, 1)) default_element_compat(ARG(0), "core VAO 0 element-buffer sub-data upload");
            return 0;
        }
        uint32_t w[] = {b->gpu, (uint32_t)off, PTR(data), len}; int accepted = send_deferred_bytes(0x41, w, 4, len);
        PendRec *r = accepted ? pend_last : 0;
        if (r) { r->kind = PR_BYTES; r->obj = (uint32_t)(b - buffers); r->off = (uint32_t)off; r->n = len; r->dst = b->data;
            r->gen_old = (uint8_t)b->generated; copy(r->old, b->data + off, len); }
        if (accepted) copy(b->data + off, data, len);
        glp_free(data, len); if (!accepted) return 0;
        if (!off && n == b->size) b->generated = 0;
        if (r) r->gen_clear = !off && n == b->size;
    }
    default_element_compat(ARG(0), "core VAO 0 element-buffer sub-data upload"); return 0;
}
static uint32_t api_CopyBufferSubData(void) {
    Buffer *src = bound_buffer(ARG(0)), *dst = bound_buffer(ARG(1));
    int64_t so = (int64_t)ARG64(2), off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
    if (!src || !dst) return 0;
    if (src->map || dst->map) { fail(BAD_OP); return 0; }
    if (so < 0 || off < 0 || size < 0 || (uint64_t)so > src->size || (uint64_t)off > dst->size ||
        (uint64_t)size > src->size - (uint64_t)so || (uint64_t)size > dst->size - (uint64_t)off ||
        (src == dst && so < off + size && off < so + size)) { fail(BAD_VALUE); return 0; }
    if (tf_active) for (uint32_t i = 0; i < 4; i++) if (tf_bound[i] == (uint32_t)(src - buffers) ||
        tf_bound[i] == (uint32_t)(dst - buffers)) { fail(BAD_OP); return 0; }
    if (!size) return 0;
    if (!src->generated && dst->generated && !off && (uint64_t)size == dst->size && dst->size != dst->cap) {
        /* K57: CPU-authoritative bytes over a generated store with spare capacity: exact-size store. */
        uint8_t *exact = glp_alloc((uint32_t)size); if (!exact) { fail(OOM); return 0; }
        copy(exact, src->data + so, (uint32_t)size); buffer_store(dst, exact, (uint32_t)size, (uint32_t)size, 1); return 0;
    }
    uint32_t w[] = {src->gpu, (uint32_t)so, dst->gpu, (uint32_t)off, (uint32_t)size};
    if (send(0x64, w, 5)) {
        copy(dst->data + off, src->data + so, (uint32_t)size);
        if (src->generated) dst->generated = 1; else if (!off && (uint64_t)size == dst->size) dst->generated = 0;
    }
    return 0;
}
static void collect_deleted(void);
static uint32_t api_DeleteBuffers(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) {
        uint32_t id = SLOT(buffers, x86_rd32(ARG(1) + 4 * i)); if (!id || id >= BN) continue;
        if (tf_active) { int bound = 0; for (uint32_t j = 0; j < 4; j++) if (tf_bound[j] == id) bound = 1;
            if (bound) { fail(BAD_OP); continue; } }
        uint32_t local = vaos[vao].element == id;
        for (uint32_t a = 0; a < 16; a++) local += vaos[vao].a[a].buffer == id;
        int retained = buffers[id].vao_refs > local;
        if (!retained && buffers[id].gpu) {
            if (!send(0x42, &buffers[id].gpu, 1)) continue;
            buffers[id].gpu = 0;
        }
        retire_name(OBJECTS(buffers), id);
        if (array == id) array = 0;
        if (uniform == id) uniform = 0;
        { uint32_t j = vao;
            if (vaos[j].element == id) { vaos[j].element = 0; buffer_unref(id); }
            for (uint32_t a = 0; a < 16; a++) if (vaos[j].a[a].buffer == id) { vaos[j].a[a].buffer = 0; buffer_unref(id); }
        }
        for (uint32_t j = 0; j < GL_UBO_BINDINGS; j++) if (ubo[j] == id) ubo[j] = 0;
        if (tf_buffer == id) tf_buffer = 0;
        if (copy_read == id) copy_read = 0;
        if (copy_write == id) copy_write = 0;
        if (pixel_pack == id) pixel_pack = 0;
        if (pixel_unpack == id) pixel_unpack = 0;
        if (texture_buffer == id) texture_buffer = 0;
        for (uint32_t j = 0; j < 4; j++) if (tf_bound[j] == id) tf_bound[j] = 0;
    } collect_deleted(); return 0;
}
static uint32_t api_BindBufferBase(void) {
    if (ARG(0) == FEEDBACK_BUFFER) {
        uint32_t s = ARG(1);
        if (s >= 4) { fail(BAD_VALUE); return 0; }
        if (tf_active) { fail(BAD_OP); return 0; }
        uint32_t id = BIND(buffers, ARG(2)); if (id >= BN) return 0;

        if (id) buffers[id].bound = 1;
        tf_buffer = tf_bound[s] = id; tf_offset[s] = 0; tf_whole[s] = 1; tf_size[s] = buffers[id].size; return 0;
    }
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    if (ARG(1) >= GL_UBO_BINDINGS) { fail(BAD_VALUE); return 0; }
    uint32_t s = ARG(1), id = BIND(buffers, ARG(2)); if (id >= BN) return 0; if (id) buffers[id].bound = 1; uniform = id; ubo[s] = id; ubo_offset[s] = 0;

    ubo_whole[s] = 1; ubo_size[s] = buffers[id].size; return 0;
}
static uint32_t api_BindBufferRange(void) {
    if (ARG(0) == FEEDBACK_BUFFER) {
        uint32_t s = ARG(1), id = SLOT(buffers, ARG(2)); int64_t off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
        if (s >= 4 || id >= BN) { fail(BAD_VALUE); return 0; }
        if (tf_active) { fail(BAD_OP); return 0; }
        if (id && (off < 0 || size <= 0 || (off & 3) || (size & 3) || (uint64_t)off + (uint64_t)size > buffers[id].size)) { fail(BAD_VALUE); return 0; }

        tf_buffer = tf_bound[s] = id; tf_offset[s] = id ? (uint32_t)off : 0; tf_size[s] = id ? (uint32_t)size : 0; tf_whole[s] = 0; return 0;
    }
    if (ARG(0) != UNIFORM_BUFFER) { fail(BAD_ENUM); return 0; }
    uint32_t s = ARG(1), id = SLOT(buffers, ARG(2)); int64_t off = (int64_t)ARG64(3), size = (int64_t)ARG64(4);
    if (s >= GL_UBO_BINDINGS || id >= BN || (id && (off < 0 || size <= 0 || (off & 255) ||
        (uint64_t)off > buffers[id].size || (uint64_t)size > buffers[id].size - (uint64_t)off))) {
        fail(BAD_VALUE); return 0;
    }

    uniform = id; ubo[s] = id; ubo_offset[s] = id ? (uint32_t)off : 0;
    ubo_size[s] = id ? (uint32_t)size : 0; ubo_whole[s] = 0; return 0;
}
static uint32_t api_GenVertexArrays(void) {
    GEN_CHECK(vaos);
    for (uint32_t i = 0; i < ARG(0); i++) x86_wr32(ARG(1) + 4 * i, NAME(vaos, alloc_name(vaos, sizeof(Vao))));
    return 0;
}
static uint32_t api_BindVertexArray(void) {
    uint32_t id = SLOT(vaos, ARG(0));
    if (id >= VN) { fail(BAD_OP); return 0; }
    vao = id; if (id) vaos[id].bound = 1; return 0;
}
static uint32_t api_DeleteVertexArrays(void) {
    if ((int32_t)ARG(0) < 0) { fail(BAD_VALUE); return 0; }
    for (uint32_t i = 0; i < ARG(0); i++) { uint32_t id = SLOT(vaos, x86_rd32(ARG(1) + i * 4));
        if (id && id < VN) {
            buffer_unref(vaos[id].element);
            for (uint32_t a = 0; a < 16; a++) buffer_unref(vaos[id].a[a].buffer);
            erase_name(OBJECTS(vaos), id); if (vao == id) vao = 0;
        } } return 0;
}
static uint32_t attribute(int integer) {
    uint32_t a = ARG(0), count = ARG(1), type = ARG(2), stride = ARG(integer ? 3 : 4);
    if (a >= 16 || count < 1 || count > 4 || stride > 2048) { fail(BAD_VALUE); return 0; }
    if (!vao || !array) { fail(BAD_OP); return 0; }
    if (integer ? (type != U32 && type != 0x1404) :
        (type != F32 && !(type == U8 && count == 4 && (ARG(3) & 255)))) {
        /* Numeric conversion of other GL vertex formats needs expansion, never bit reinterpretation. */
        fail(BAD_ENUM); return 0;
    }
    Attribute *v = &vaos[vao].a[a];
    buffer_unref(v->buffer);
    buffers[array].vao_refs++; v->buffer = array; v->count = count; v->type = type;
    v->normalized = integer ? 0 : (ARG(3) & 255); v->integer = integer;
    v->stride = stride ? stride : count * (type == U8 ? 1 : 4); v->offset = ARG(integer ? 4 : 5); return 0;
}
static uint32_t api_VertexAttribPointer(void) { return attribute(0); }
static uint32_t api_VertexAttribIPointer(void) { return attribute(1); }
static uint32_t api_EnableVertexAttribArray(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP); else vaos[vao].a[ARG(0)].enabled = 1;
    return 0;
}
static uint32_t api_DisableVertexAttribArray(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP); else vaos[vao].a[ARG(0)].enabled = 0;
    return 0;
}
static void ensure_current_buffer(uint32_t instances) {
    init_current_attr(); if (!instances) instances = 1;
    if (instances > current_capacity) {
        uint32_t capacity = 1; while (capacity < instances) capacity *= 2;
        uint32_t *data = (uint32_t *)glp_alloc(capacity * 256u);
        if (!data) { fail(OOM); return; }
        if (current_gpu) SEND(0x42, current_gpu);
        glp_free(current_data, current_capacity * 256u); current_data = data; current_capacity = capacity;
        /* Private current-attribute handle, excluded from the shared public/uniform pool. */
        current_gpu = 1023;
        SEND(0x40, current_gpu, 1, capacity * 256u, 0, 0);
        if (error) {
            glp_free(current_data, current_capacity * 256u); current_data = 0;
            current_gpu = current_capacity = 0; return;
        }
    }
    for (uint32_t n = 0; n < instances; n++) for (uint32_t i = 0; i < 16; i++) for (uint32_t j = 0; j < 4; j++)
        current_data[n * 64 + i * 4 + j] = bits(current_attr[i][j]);
    SEND(0x41, current_gpu, 0, PTR(current_data), instances * 256u);
}
static uint32_t api_VertexAttribDivisor(void) {
    if (ARG(0) >= 16) fail(BAD_VALUE); else if (!vao) fail(BAD_OP);
    else if (ARG(1) > 1) fail(BAD_VALUE); else vaos[vao].a[ARG(0)].divisor = ARG(1);
    return 0;
}

#include "w32_gl_buffer.h"
#include "w32_gl_fmt.h"
static uint32_t texture_handle(uint32_t preferred, const char *kind) {
    if (preferred && preferred <= GPU_MAX && !(preferred >= 900 && preferred <= 921) && !gpu_texture[preferred]) return preferred;
    for (uint32_t h = 1; h <= GPU_MAX; h++) if (!(h >= 900 && h <= 921) && !gpu_texture[h]) return h;
    object_exhaustion(kind, "GPU texture handles", 1); return 0;
}
#include "w32_gl_tex.h"
#include "w32_gl_fbo.h"

#include "w32_gl_feedback.h"
#include "w32_gl_shader.h"
#include "w32_gl_draw.h"
#include "w32_gl_query.h"

static void init_objects(void) {
    OBJECTS(textures); OBJECTS(buffers); OBJECTS(vaos); OBJECTS(fbos); OBJECTS(rbos);
    OBJECTS(samplers); OBJECTS(gl_queries); OBJECTS(shaders); OBJECTS(programs);
}

/* Deleted names are reusable immediately; unbound container references retain the old
 * object/handle generation until detached. Slots are never reused underneath an attachment. */
static int attached_image(uint32_t type, uint32_t id) {
    for (uint32_t f = 1; f < N; f++) if (fbos[f].used) {
        Fbo *p = &fbos[f];
        for (uint32_t c = 0; c < 4; c++) if (p->color[c].type == type && p->color[c].name == id) return 1;
        if ((p->depth.type == type && p->depth.name == id) || (p->stencil.type == type && p->stencil.name == id)) return 1;
    }
    return 0;
}
/* Retirement is cold work. Sort only its candidates (not the live namespace),
 * preserving the historical ascending-slot destroy stream without allocating. */
static uint32_t sort_retired_buffers(uint32_t head) {
    if (!head || !buffers[head].collect_next) return head;
    uint32_t slow = head, fast = buffers[head].collect_next;
    while (fast && buffers[fast].collect_next) {
        slow = buffers[slow].collect_next; fast = buffers[buffers[fast].collect_next].collect_next;
    }
    uint32_t right = buffers[slow].collect_next; buffers[slow].collect_next = 0;
    uint32_t a = sort_retired_buffers(head), b = sort_retired_buffers(right), result = 0, *tail = &result;
    while (a || b) {
        uint32_t next;
        if (!b || (a && a < b)) { next = a; a = buffers[a].collect_next; }
        else { next = b; b = buffers[b].collect_next; }
        *tail = next; tail = &buffers[next].collect_next;
    }
    *tail = 0; return result;
}
static void collect_deleted(void) {
    if (!gl_retired) return;
    /* Detach the candidate list: rejected destroys retry on the next call, not in
     * an infinite loop here. Slot links survive table relocation. */
    uint32_t candidate = sort_retired_buffers(retired_buffer_head); retired_buffer_head = 0;
    while (candidate) {
        GL_WORK();
        uint32_t id = candidate; candidate = buffers[id].collect_next;
        buffers[id].collect_next = buffers[id].collect_queued = 0;
        if (buffers[id].vao_refs) continue;
        if (buffers[id].gpu && !cleanup_send("buffers", 0x42, buffers[id].gpu)) { queue_retired_buffer(id); continue; }
        unmap_storage(&buffers[id]); retire_block(buffers[id].data, buffers[id].cap); store_size(&buffers[id], 0, 0);
        erase_name(OBJECTS(buffers), id);
    }
    if (!image_collection_dirty) return;
    image_collection_dirty = 0;
    GlObjects *to = OBJECTS(textures), *ro = OBJECTS(rbos);
    for (uint32_t id = 1; id < N; id++) {
        GL_WORK();
        if (to->retired[id] && !attached_image(1, id)) {
            if (textures[id].gpu && !cleanup_send("textures", 0x45, textures[id].gpu)) image_collection_dirty = 1;
            else { zero(&textures[id], sizeof(Texture)); to->retired[id] = 0; gl_retired--; }
        }
        if (ro->retired[id] && !attached_image(2, id)) {
            if (rbos[id].gpu && !cleanup_send("rbos", 0x45, rbos[id].gpu)) image_collection_dirty = 1;
            else { zero(&rbos[id], sizeof(Rbo)); ro->retired[id] = 0; gl_retired--; }
        }
    }
}
static int object_entry(const char *name, const char *part) {
    for (; *name; name++) { const char *a = name, *b = part; while (*b && *a == *b) { a++; b++; } if (!*b) return 1; }
    return 0;
}
static const char *entry_objects(const char *name) {
    if (object_entry(name, "Renderbuffer")) { OBJECTS(rbos); return "rbos"; }
    if (object_entry(name, "Framebuffer")) { OBJECTS(fbos); return "fbos"; }
    if (object_entry(name, "Tex")) { OBJECTS(textures); return "textures"; }
    if (object_entry(name, "Buffer")) { OBJECTS(buffers); return "buffers"; }
    if (object_entry(name, "Sampler")) { OBJECTS(samplers); return "samplers"; }
    if (object_entry(name, "VertexArray")) { OBJECTS(vaos); return "vaos"; }
    if (object_entry(name, "Shader")) { OBJECTS(shaders); return "shaders"; }
    if (object_entry(name, "Quer")) { OBJECTS(gl_queries); return "gl_queries"; }
    OBJECTS(programs); return "programs";
}
#define API(name, fn, nargs, mutates) \
    static uint32_t errs_##fn; \
    static uint32_t call_##fn(void) { \
        w32_gl_calls++; \
        if (eq(name, "glGetError")) return api_##fn(); \
        uint64_t raised = w32_gl_errors_raised; \
        uint32_t pending = error, exhaustion_before = gl_exhaustion_events, outer = latch_outer; error = 0; \
        latch_outer = pending; \
        int protects_source = eq(name, "glBufferData") || eq(name, "glBufferSubData") || \
            eq(name, "glDeleteBuffers") || eq(name, "glCopyBufferSubData") || \
            eq(name, "glUnmapBuffer") || eq(name, "glFlushMappedBufferRange"); \
        uint32_t result = (!protects_source || flush_padded_cleanup()) ? api_##fn() : 0; \
        collect_deleted(); collect_wire(); \
        if (error == OOM && exhaustion_before == gl_exhaustion_events) \
            object_exhaustion(entry_objects(name), "host/GPU byte or submission budget", 1); \
        if (!error) w32_gl_state_changes += mutates; \
        if (w32_gl_errors_raised != raised) errs_##fn++; \
        if (pending) error = pending; \
        latch_outer = outer; \
        return result; \
    }
#define GLSTUB(name, fn, nargs, mutates) \
    static uint32_t errs_##fn; \
    static uint32_t call_##fn(void) { w32_gl_calls++; errs_##fn++; missing(name); fail(BAD_OP); return 0; }
#include "w32_gl_api.h"
#undef API
#undef GLSTUB
#define API(name, fn, nargs, mutates) {name, nargs, 0, call_##fn},
#define GLSTUB API
const w32_api_t w32_api_gl[] = {
#include "w32_gl_api.h"
};
#undef API
#undef GLSTUB
const uint32_t w32_api_gl_n = sizeof w32_api_gl / sizeof w32_api_gl[0];
/* K61 error census: {"entry": calls that raised a GL error, ...}, in table order, nonzero entries only. */
static uint32_t census_put(char *s, uint32_t n, uint32_t cap, const char *name, uint32_t count) {
    char digits[12]; uint32_t d = 0, len = w32_slen(name);
    do { digits[d++] = (char)('0' + count % 10); count /= 10; } while (count);
    if (n + len + d + 6 >= cap) return n;
    if (n > 1) s[n++] = ',';
    s[n++] = '"'; copy(s + n, name, len); n += len; s[n++] = '"'; s[n++] = ':';
    while (d) s[n++] = digits[--d];
    return n;
}
const char *w32_gl_error_calls_json(void) {
    static char s[4096]; uint32_t n = 0; s[n++] = '{';
#define API(name, fn, nargs, mutates) if (errs_##fn) n = census_put(s, n, sizeof s - 2, name, errs_##fn);
#define GLSTUB API
#include "w32_gl_api.h"
#undef API
#undef GLSTUB
    s[n++] = '}'; s[n] = 0; return s;
}
#if !(UINTPTR_MAX > 0xffffffffu || W32_GL_SYNC_SUBMIT)
/* Journal effects for a replayed batch (see replay). Undo runs newest-first over every record and
 * restores the pre-batch profile state; redo runs oldest-first over the accepted records; reject
 * withdraws what a rejected call committed; fixup reconciles buffer objects with the wire truth. */
static void pend_undo(PendRec *r) {
    switch (r->kind) {
    case PR_BYTES: {
        Buffer *b = &buffers[r->obj];
        uint8_t *d = r->dst ? r->dst : b->data;
        if (d && (d != b->data || r->off + r->n <= b->cap)) __builtin_memcpy(d + r->off, r->old, r->n);
        b->generated = r->gen_old;
        if (r->resize && d == b->data) store_size(b, r->size_old, b->cap);
        break;
    }
    case PR_DRAW:
        for (uint32_t i = r->tf_n; i-- > 0;) buffers[r->tf_obj[i]].generated = r->tf_gen[i];
        break;
    case PR_RELEASE: if (r->handle < buffer_wire_slots) gpu_buffer[r->handle] = 1; break;
    case PR_CREATE:
        if (r->handle < buffer_wire_slots) {
            gpu_buffer[r->handle] = 0; if (r->handle < buffer_next_free) buffer_next_free = r->handle;
        }
        break;
    default: break;
    }
}
static void pend_redo(PendRec *r) {
    switch (r->kind) {
    case PR_BYTES: {
        Buffer *b = &buffers[r->obj];
        uint8_t *d = r->dst ? r->dst : b->data;
        if (d && (d != b->data || r->off + r->n <= b->cap)) __builtin_memcpy(d + r->off, r->src, r->n);
        /* A call's own effect on generation is a transition (whole-store write clears it, a partial write
         * keeps it), never an absolute value: earlier calls in the batch may have been rejected. */
        if (r->gen_clear) b->generated = 0;
        if (r->resize && d == b->data) store_size(b, r->size_new, b->cap);
        break;
    }
    case PR_DRAW: for (uint32_t i = 0; i < r->tf_n; i++) buffers[r->tf_obj[i]].generated = 1; break;
    case PR_RELEASE:
        if (r->handle < buffer_wire_slots) {
            gpu_buffer[r->handle] = 0; if (r->handle < buffer_next_free) buffer_next_free = r->handle;
        }
        break;
    case PR_CREATE:
        if (r->handle < buffer_wire_slots) gpu_buffer[r->handle] = 1;
        if (buffers[r->obj].gpu == r->handle) buffers[r->obj].generated = 0; /* a fresh store; later captures redo after */
        break;
    default: break;
    }
}
static void pend_reject(PendRec *r) {
    switch (r->kind) {
    case PR_UBO: programs[r->obj].dirty = 1; break;
    case PR_DRAW:
        if (w32_gl_draws) w32_gl_draws--;
        for (uint32_t i = 0; i < r->tf_n; i++) if (tf_active && tf_cursor[i] >= r->tf_add[i]) tf_cursor[i] -= r->tf_add[i];
        if (r->tf_n && r->tf_query && gl_queries[r->tf_query].result >= r->tf_prims) gl_queries[r->tf_query].result -= r->tf_prims;
        break;
    default: break;
    }
}
/* After undo/redo, gpu_buffer[] is the host's truth. A buffer whose CREATE was rejected (or never
 * reached the host because its DELETE was) is left empty, as the unbatched failure path leaves it;
 * a store whose DELETE was rejected is still live on the host and is released later (collect_wire). */
static void pend_fixup(PendRec *r, int accepted) {
    if (r->handle >= buffer_wire_slots) return;
    if (r->kind == PR_CREATE) {
        Buffer *b = &buffers[r->obj];
        if (accepted) { if (b->gpu == r->handle && b->cap > r->cap) store_size(b, b->size < r->cap ? b->size : r->cap, r->cap); return; }
        if (b->gpu != r->handle) return;
        unmap_storage(b); glp_free(b->data, b->cap); b->data = 0;
        store_size(b, 0, 0); b->gpu = b->generated = 0;
        object_exhaustion("buffers", "GPU byte/submission budget", 1);
    } else if (r->kind == PR_RELEASE && !accepted && gpu_buffer[r->handle] && !abandoned_buffer[r->handle]) {
        abandoned_buffer[r->handle] = 2; abandoned_buffers++;
    }
}
#endif
