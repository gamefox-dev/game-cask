/* Compiled by tests/unit/abi-layout.test.ts: exposes header layout and a
 * command buffer encoded by the C helpers, for comparison with abi.ts. */
#include "bgt.h"
#include "bgt_cmd.h"

#define OFF(f) (uint32_t)offsetof(bgt_io_t, f)
static const uint32_t table[] = {
    sizeof(bgt_io_t), sizeof(bgt_touch_t), sizeof(bgt_sprite_t), sizeof(bgt_vertex_t),
    OFF(abi_version), OFF(backend), OFF(caps), OFF(audio_sample_rate), OFF(seed), OFF(display_width),
    OFF(display_height), OFF(arg0), OFF(logical_width), OFF(logical_height), OFF(flags), OFF(arg1),
    OFF(frame), OFF(buttons), OFF(buttons_pressed), OFF(buttons_released), OFF(keys), OFF(keys_pressed),
    OFF(pointer_x), OFF(pointer_y), OFF(pointer_buttons), OFF(pointer_inside), OFF(axes), OFF(touch_count),
    OFF(events), OFF(touches),
    BGT_ABI_VERSION, BGT_CMD_MAGIC, BGT_CMD_VERSION,
    BGT_OP_CLEAR, BGT_OP_VIEWPORT, BGT_OP_SCISSOR, BGT_OP_TRANSFORM, BGT_OP_BLEND, BGT_OP_TEXTURE,
    BGT_OP_TEX_CREATE, BGT_OP_TEX_UPDATE, BGT_OP_TEX_DELETE, BGT_OP_SPRITES, BGT_OP_TRIANGLES,
    (uint32_t)BGT_E_INVALID, (uint32_t)BGT_E_BOUNDS, (uint32_t)BGT_E_LIMIT, (uint32_t)BGT_E_UNSUPPORTED,
    (uint32_t)BGT_E_NOT_FOUND, (uint32_t)BGT_E_IO, (uint32_t)BGT_E_STATE,
    BGT_LIMIT_SUBMIT_BYTES, BGT_LIMIT_COMMANDS, BGT_LIMIT_SUBMITS_PER_FRAME, BGT_LIMIT_VERTICES_PER_FRAME,
    BGT_LIMIT_TEXTURES, BGT_LIMIT_TEXTURE_DIM, BGT_LIMIT_TEXTURE_BYTES, BGT_LIMIT_LOGICAL_DIM,
    BGT_BTN_UP, BGT_BTN_START, BGT_BTN_R, BGT_CAP_DIRECT_DRAW, BGT_EVENT_FOCUS_LOST, BGT_FLAG_INTEGER_SCALE,
    BGT_KEY_A, BGT_KEY_Z, BGT_KEY_ENTER, BGT_KEY_SPACE, BGT_KEY_RIGHT, BGT_KEY_UP, BGT_KEY_LSHIFT, BGT_DT_US,
    BGT_OP_READBACK, BGT_CAP_READBACK, BGT_CAP_STREAM_FILES, sizeof(bgt_gpu_limits_t),
    offsetof(bgt_gpu_limits_t,texture_budget_bytes),
};
BGT_EXPORT(probe_table) uint32_t probe_table(void) { return (uint32_t)(uintptr_t)table; }
BGT_EXPORT(probe_count) uint32_t probe_count(void) { return sizeof table / sizeof table[0]; }

static uint32_t storage[1024];
static bgt_cmdbuf_t cb;
static uint32_t last_ptr, last_len;

BGT_EXPORT(probe_encode) int32_t probe_encode(void) {
    bgt_cmd_init(&cb, storage, sizeof storage);
    bgt_cmd_clear(&cb, BGT_RGBA(1, 2, 3, 4));
    bgt_cmd_viewport(&cb, 1, -2, 300, 200);
    bgt_cmd_scissor(&cb, 1, 4, 5, 6, 7);
    bgt_cmd_transform(&cb, 1.5f, 0, 0, 2, -3, 4);
    bgt_cmd_blend(&cb, BGT_BLEND_ADD);
    bgt_cmd_tex_create(&cb, 9, 4, 4);
    bgt_cmd_tex_update(&cb, 9, 0, 0, 4, 4, (const void *)(uintptr_t)4096, 64);
    bgt_cmd_texture(&cb, 9, BGT_FILTER_LINEAR);
    bgt_cmd_sprite(&cb, 1, 2, 3, 4, 0, 0, 1, 1, 0xffffffffu);
    bgt_cmd_sprite(&cb, 5, 6, 7, 8, 0.25f, 0.5f, 0.75f, 1, 0x80808080u); /* coalesced into the same SPRITES */
    bgt_vertex_t *v = bgt_cmd_triangles(&cb, 3);
    for (int i = 0; i < 3; i++) { v[i].x = (float)i; v[i].y = (float)(i * 2); v[i].u = 0; v[i].v = 1; v[i].rgba = 0xff00ff00u; }
    bgt_cmd_tex_delete(&cb, 9);
    last_ptr = (uint32_t)(uintptr_t)cb.buf;
    last_len = cb.len;
    return bgt_cmd_submit(&cb);
}
BGT_EXPORT(probe_last_ptr) uint32_t probe_last_ptr(void) { return last_ptr; }
BGT_EXPORT(probe_last_len) uint32_t probe_last_len(void) { return last_len; }

BGT_EXPORT(probe_readback) int32_t probe_readback(void) {
    bgt_cmd_init(&cb,storage,sizeof storage);bgt_cmd_readback(&cb,77,9,1,2,3,4);return bgt_cmd_submit(&cb);
}

/* overflow: a tiny buffer must report BGT_E_LIMIT rather than write past the end */
static uint32_t tiny[8];
BGT_EXPORT(probe_overflow) int32_t probe_overflow(void) {
    bgt_cmd_init(&cb, tiny, sizeof tiny);
    for (int i = 0; i < 10; i++) bgt_cmd_clear(&cb, 0);
    return bgt_cmd_submit(&cb);
}
