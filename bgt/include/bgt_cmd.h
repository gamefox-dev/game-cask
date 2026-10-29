/*
 * BGT command stream v1 — encoder helpers (header-only).
 *
 * Wire format (all little-endian, 4-byte aligned):
 *   header  : u32 magic 'BGTC' | u16 version | u16 flags(0) | u32 byte_len | u32 cmd_count
 *   command : u16 opcode | u16 flags(0) | u32 payload_len (multiple of 4) | payload
 *
 * Coordinates are logical pixels (see bgt_io_t.logical_width/height),
 * origin top-left, +y down. Colors are RGBA8 packed as r | g<<8 | b<<16 | a<<24.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef BGT_CMD_H
#define BGT_CMD_H

#include "bgt.h"

#define BGT_CMD_MAGIC   0x43544742u /* "BGTC" */
#define BGT_CMD_VERSION 1u
#define BGT_CMD_HEADER_SIZE 16u
#define BGT_CMD_PREFIX_SIZE 8u

enum {
    BGT_OP_CLEAR      = 0x01, /* u32 rgba                                         fills current clip  */
    BGT_OP_VIEWPORT   = 0x02, /* i32 x, y, w, h   origin offset + clip, logical px                    */
    BGT_OP_SCISSOR    = 0x03, /* u32 enable, i32 x, y, w, h   absolute logical px                     */
    BGT_OP_TRANSFORM  = 0x04, /* f32 a, b, c, d, tx, ty   x' = a*x + c*y + tx ; y' = b*x + d*y + ty  */
    BGT_OP_BLEND      = 0x05, /* u32 mode (BGT_BLEND_*)                                                */
    BGT_OP_TEXTURE    = 0x06, /* u32 handle (0 = built-in 1x1 white), u32 filter (BGT_FILTER_*)       */
    BGT_OP_TARGET     = 0x07, /* v0.2: u32 handle: draw into this render-target texture (0 = screen)   */
    BGT_OP_TEX_CREATE = 0x10, /* u32 handle, w, h, format (BGT_FORMAT_RGBA8)                           */
    BGT_OP_TEX_UPDATE = 0x11, /* u32 handle, x, y, w, h, data_ptr, data_len (== w*h*4, tight rows)    */
    BGT_OP_TEX_DELETE = 0x12, /* u32 handle                                                            */
    BGT_OP_SPRITES    = 0x20, /* u32 count, then count * bgt_sprite_t                                  */
    BGT_OP_TRIANGLES  = 0x21  /* u32 vertex_count (multiple of 3), then vertex_count * bgt_vertex_t    */
};

#define BGT_BLEND_OPAQUE        0u
#define BGT_BLEND_ALPHA         1u /* src*a + dst*(1-a)              */
#define BGT_BLEND_ADD           2u /* src*a + dst                    */
#define BGT_BLEND_PREMULTIPLIED 3u /* src + dst*(1-a)                */
#define BGT_BLEND_INVERT        4u /* v0.2: dst = 1 - dst (src ignored; alpha kept) */
#define BGT_BLEND_MULTIPLY      5u /* v0.2: dst = src * dst          */

#define BGT_FILTER_NEAREST 0u
#define BGT_FILTER_LINEAR  1u

#define BGT_FORMAT_RGBA8 0u
#define BGT_TEX_RENDER_TARGET (1u << 8) /* v0.2: OR into TEX_CREATE format: texture can be a TARGET */

/* v0.1 limits — enforced by the runtime, mirrored here for game-side checks */
#define BGT_LIMIT_SUBMIT_BYTES     (8u * 1024u * 1024u)
#define BGT_LIMIT_COMMANDS         65536u
#define BGT_LIMIT_SUBMITS_PER_FRAME 256u
#define BGT_LIMIT_VERTICES_PER_FRAME 1572864u
#define BGT_LIMIT_TEXTURES         1024u   /* handles 1..1023 */
#define BGT_LIMIT_TEXTURE_DIM      4096u
#define BGT_LIMIT_TEXTURE_BYTES    (256u * 1024u * 1024u)
#define BGT_LIMIT_LOGICAL_DIM      4096u

#define BGT_RGBA(r, g, b, a) ((uint32_t)(r) | ((uint32_t)(g) << 8) | ((uint32_t)(b) << 16) | ((uint32_t)(a) << 24))

typedef struct bgt_sprite {
    float x, y, w, h;      /* destination rect, logical px, before transform */
    float u0, v0, u1, v1;  /* normalized texture coordinates                 */
    uint32_t rgba;         /* tint, multiplied with texel                    */
} bgt_sprite_t;            /* 36 bytes */

typedef struct bgt_vertex {
    float x, y, u, v;
    uint32_t rgba;
} bgt_vertex_t;            /* 20 bytes */

typedef struct bgt_cmdbuf {
    uint8_t *buf;
    uint32_t cap;
    uint32_t len;
    uint32_t count;
    uint32_t last_op_off;  /* offset of last command prefix, 0 if none */
    int32_t  error;        /* sticky: BGT_E_LIMIT when the buffer overflowed */
} bgt_cmdbuf_t;

static inline void bgt__put32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static inline uint32_t bgt__get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline uint32_t bgt__f2u(float f) { union { float f; uint32_t u; } c; c.f = f; return c.u; }

static inline void bgt_cmd_reset(bgt_cmdbuf_t *b) {
    b->len = BGT_CMD_HEADER_SIZE;
    b->count = 0;
    b->last_op_off = 0;
    b->error = BGT_OK;
}

/* storage must be 4-byte aligned and at least BGT_CMD_HEADER_SIZE bytes */
static inline void bgt_cmd_init(bgt_cmdbuf_t *b, void *storage, uint32_t cap) {
    b->buf = (uint8_t *)storage;
    b->cap = cap;
    bgt_cmd_reset(b);
}

/* Reserve a command; returns pointer to payload or NULL (sets sticky error). */
static inline uint8_t *bgt_cmd_push(bgt_cmdbuf_t *b, uint32_t op, uint32_t payload_len) {
    uint32_t need = BGT_CMD_PREFIX_SIZE + payload_len;
    if (b->error || (payload_len & 3u) || b->len + need > b->cap || b->count >= BGT_LIMIT_COMMANDS) {
        b->error = BGT_E_LIMIT;
        return 0;
    }
    uint8_t *p = b->buf + b->len;
    bgt__put32(p, op & 0xffffu);
    bgt__put32(p + 4, payload_len);
    b->last_op_off = b->len;
    b->len += need;
    b->count++;
    return p + BGT_CMD_PREFIX_SIZE;
}

static inline void bgt_cmd_clear(bgt_cmdbuf_t *b, uint32_t rgba) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_CLEAR, 4);
    if (p) bgt__put32(p, rgba);
}

static inline void bgt_cmd_viewport(bgt_cmdbuf_t *b, int32_t x, int32_t y, int32_t w, int32_t h) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_VIEWPORT, 16);
    if (p) { bgt__put32(p, (uint32_t)x); bgt__put32(p + 4, (uint32_t)y); bgt__put32(p + 8, (uint32_t)w); bgt__put32(p + 12, (uint32_t)h); }
}

static inline void bgt_cmd_scissor(bgt_cmdbuf_t *b, uint32_t enable, int32_t x, int32_t y, int32_t w, int32_t h) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_SCISSOR, 20);
    if (p) { bgt__put32(p, enable); bgt__put32(p + 4, (uint32_t)x); bgt__put32(p + 8, (uint32_t)y); bgt__put32(p + 12, (uint32_t)w); bgt__put32(p + 16, (uint32_t)h); }
}

static inline void bgt_cmd_transform(bgt_cmdbuf_t *b, float a, float bb, float c, float d, float tx, float ty) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TRANSFORM, 24);
    if (p) {
        bgt__put32(p, bgt__f2u(a)); bgt__put32(p + 4, bgt__f2u(bb)); bgt__put32(p + 8, bgt__f2u(c));
        bgt__put32(p + 12, bgt__f2u(d)); bgt__put32(p + 16, bgt__f2u(tx)); bgt__put32(p + 20, bgt__f2u(ty));
    }
}

static inline void bgt_cmd_identity(bgt_cmdbuf_t *b) { bgt_cmd_transform(b, 1, 0, 0, 1, 0, 0); }

static inline void bgt_cmd_blend(bgt_cmdbuf_t *b, uint32_t mode) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_BLEND, 4);
    if (p) bgt__put32(p, mode);
}

static inline void bgt_cmd_texture(bgt_cmdbuf_t *b, uint32_t handle, uint32_t filter) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TEXTURE, 8);
    if (p) { bgt__put32(p, handle); bgt__put32(p + 4, filter); }
}

static inline void bgt_cmd_tex_create_fmt(bgt_cmdbuf_t *b, uint32_t handle, uint32_t w, uint32_t h, uint32_t format) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TEX_CREATE, 16);
    if (p) { bgt__put32(p, handle); bgt__put32(p + 4, w); bgt__put32(p + 8, h); bgt__put32(p + 12, format); }
}
static inline void bgt_cmd_tex_create(bgt_cmdbuf_t *b, uint32_t handle, uint32_t w, uint32_t h) {
    bgt_cmd_tex_create_fmt(b, handle, w, h, BGT_FORMAT_RGBA8);
}
/* v0.2: render target (persistent across frames; starts transparent black). */
static inline void bgt_cmd_target_create(bgt_cmdbuf_t *b, uint32_t handle, uint32_t w, uint32_t h) {
    bgt_cmd_tex_create_fmt(b, handle, w, h, BGT_FORMAT_RGBA8 | BGT_TEX_RENDER_TARGET);
}
/* v0.2: subsequent draws go into render target `handle` (0 = screen). Resets viewport/scissor to the
 * target's size; transform/blend/texture are kept. */
static inline void bgt_cmd_target(bgt_cmdbuf_t *b, uint32_t handle) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TARGET, 4);
    if (p) bgt__put32(p, handle);
}

/* data must stay valid until bgt_submit_commands returns (it is copied then). */
static inline void bgt_cmd_tex_update(bgt_cmdbuf_t *b, uint32_t handle, uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                                      const void *data, uint32_t data_len) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TEX_UPDATE, 28);
    if (p) {
        bgt__put32(p, handle); bgt__put32(p + 4, x); bgt__put32(p + 8, y); bgt__put32(p + 12, w);
        bgt__put32(p + 16, h); bgt__put32(p + 20, (uint32_t)(uintptr_t)data); bgt__put32(p + 24, data_len);
    }
}

static inline void bgt_cmd_tex_delete(bgt_cmdbuf_t *b, uint32_t handle) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TEX_DELETE, 4);
    if (p) bgt__put32(p, handle);
}

/* Appends to the previous SPRITES command when it is the last command, so
 * consecutive sprites with unchanged state become one batch. */
static inline void bgt_cmd_sprite(bgt_cmdbuf_t *b, float x, float y, float w, float h,
                                  float u0, float v0, float u1, float v1, uint32_t rgba) {
    uint8_t *p;
    uint8_t *last = b->last_op_off ? b->buf + b->last_op_off : 0;
    if (!b->error && last && (bgt__get32(last) & 0xffffu) == BGT_OP_SPRITES && b->len + 36u <= b->cap) {
        p = b->buf + b->len;
        b->len += 36u;
        bgt__put32(last + 4, bgt__get32(last + 4) + 36u);
        bgt__put32(last + 8, bgt__get32(last + 8) + 1u);
    } else {
        uint8_t *q = bgt_cmd_push(b, BGT_OP_SPRITES, 4u + 36u);
        if (!q) return;
        bgt__put32(q, 1u);
        p = q + 4;
    }
    bgt__put32(p, bgt__f2u(x)); bgt__put32(p + 4, bgt__f2u(y)); bgt__put32(p + 8, bgt__f2u(w)); bgt__put32(p + 12, bgt__f2u(h));
    bgt__put32(p + 16, bgt__f2u(u0)); bgt__put32(p + 20, bgt__f2u(v0)); bgt__put32(p + 24, bgt__f2u(u1)); bgt__put32(p + 28, bgt__f2u(v1));
    bgt__put32(p + 32, rgba);
}

static inline void bgt_cmd_rect(bgt_cmdbuf_t *b, float x, float y, float w, float h, uint32_t rgba) {
    bgt_cmd_sprite(b, x, y, w, h, 0, 0, 1, 1, rgba);
}

/* Returns pointer to vertex storage for `vertex_count` vertices (caller fills), or NULL. */
static inline bgt_vertex_t *bgt_cmd_triangles(bgt_cmdbuf_t *b, uint32_t vertex_count) {
    uint8_t *p = bgt_cmd_push(b, BGT_OP_TRIANGLES, 4u + vertex_count * 20u);
    if (!p) return 0;
    bgt__put32(p, vertex_count);
    return (bgt_vertex_t *)(void *)(p + 4);
}

/* Finalize header and submit. Returns BGT_OK or a negative error; resets the buffer. */
static inline int32_t bgt_cmd_submit(bgt_cmdbuf_t *b) {
    int32_t rc;
    if (b->error) { rc = b->error; bgt_cmd_reset(b); return rc; }
    if (b->count == 0) return BGT_OK;
    bgt__put32(b->buf, BGT_CMD_MAGIC);
    bgt__put32(b->buf + 4, BGT_CMD_VERSION);
    bgt__put32(b->buf + 8, b->len);
    bgt__put32(b->buf + 12, b->count);
    rc = bgt_submit_commands(b->buf, b->len);
    bgt_cmd_reset(b);
    return rc;
}

#endif /* BGT_CMD_H */
