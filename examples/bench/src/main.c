/*
 * BGT sprite benchmark (CC0-1.0).
 *   ?arg0=N   sprites per frame (default 2000, max 100000)
 *   ?arg1=M   0 = batched command buffer (BGT_OP_SPRITES)
 *             1 = direct-call reference: one bgt_debug_draw_sprite import per sprite
 */
#include "bgt.h"
#include "bgt_cmd.h"

#define W 640
#define H 360
#define MAX_SPRITES 100000

BGT_DEFINE_IO(io)

typedef struct { int32_t x, y, vx, vy; uint32_t c; } spr_t;
static spr_t sprites[MAX_SPRITES];
static uint32_t count, mode, rng = 1;
static uint32_t cmd_storage[(16 + MAX_SPRITES * 36 + 4096) / 4];
static bgt_cmdbuf_t cb;
static uint8_t tex[8 * 8 * 4];

static uint32_t rnd(void) { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }

BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t io_ptr) {
    (void)io_ptr;
    io.logical_width = W;
    io.logical_height = H;
    count = io.arg0 ? io.arg0 : 2000;
    if (count > MAX_SPRITES) count = MAX_SPRITES;
    mode = io.arg1;
    if (mode == 1 && !(io.caps & BGT_CAP_DIRECT_DRAW)) return BGT_E_UNSUPPORTED;
    rng = io.seed ? io.seed : 1;
    for (uint32_t i = 0; i < count; i++) {
        sprites[i].x = (int32_t)(rnd() % (W * 16));
        sprites[i].y = (int32_t)(rnd() % (H * 16));
        sprites[i].vx = (int32_t)(rnd() % 64) - 32;
        sprites[i].vy = (int32_t)(rnd() % 64) - 32;
        sprites[i].c = BGT_RGBA(128 + rnd() % 128, 128 + rnd() % 128, 128 + rnd() % 128, 255);
    }
    for (int i = 0; i < 64; i++) {
        int on = ((i % 8) + (i / 8)) % 2;
        tex[i * 4] = tex[i * 4 + 1] = tex[i * 4 + 2] = on ? 255 : 160;
        tex[i * 4 + 3] = 255;
    }
    bgt_cmd_init(&cb, cmd_storage, sizeof cmd_storage);
    bgt_cmd_tex_create(&cb, 1, 8, 8);
    bgt_cmd_tex_update(&cb, 1, 0, 0, 8, 8, tex, sizeof tex);
    return bgt_cmd_submit(&cb);
}

BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
    for (uint32_t i = 0; i < count; i++) {
        spr_t *s = &sprites[i];
        s->x += s->vx;
        s->y += s->vy;
        if (s->x < 0 || s->x > W * 16) s->vx = -s->vx;
        if (s->y < 0 || s->y > H * 16) s->vy = -s->vy;
    }
}

BGT_EXPORT(bgt_render) void bgt_render(void) {
    bgt_cmd_clear(&cb, BGT_RGBA(10, 10, 20, 255));
    bgt_cmd_texture(&cb, 1, BGT_FILTER_NEAREST);
    if (mode == 1) {
        bgt_cmd_submit(&cb);
        for (uint32_t i = 0; i < count; i++)
            bgt_debug_draw_sprite(1, (float)(sprites[i].x / 16), (float)(sprites[i].y / 16), 8, 8, 0, 0, 1, 1, sprites[i].c);
        return;
    }
    for (uint32_t i = 0; i < count; i++)
        bgt_cmd_sprite(&cb, (float)(sprites[i].x / 16), (float)(sprites[i].y / 16), 8, 8, 0, 0, 1, 1, sprites[i].c);
    bgt_cmd_submit(&cb);
}

BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}

BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {
    uint32_t h = 2166136261u;
    for (uint32_t i = 0; i < count; i++) h = (h ^ (uint32_t)sprites[i].x ^ ((uint32_t)sprites[i].y << 16)) * 16777619u;
    return h;
}
