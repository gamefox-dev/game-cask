/*
 * BGTI image loader (header-only). BGTI is produced by tools/assets/convert.mjs:
 *   "BGTI" | u32 width | u32 height | u32 flags(0) | width*height*4 RGBA8 bytes
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef BGT_IMAGE_H
#define BGT_IMAGE_H

#include "bgt.h"

typedef struct bgt_image {
    uint32_t width, height;
    const uint8_t *rgba; /* points into the caller's buffer */
} bgt_image_t;

/* Parse a BGTI blob already read into memory. Returns BGT_OK or an error. */
static inline int32_t bgt_image_parse(const uint8_t *data, uint32_t len, bgt_image_t *out) {
    if (len < 16 || data[0] != 'B' || data[1] != 'G' || data[2] != 'T' || data[3] != 'I') return BGT_E_INVALID;
    uint32_t w = (uint32_t)data[4] | ((uint32_t)data[5] << 8) | ((uint32_t)data[6] << 16) | ((uint32_t)data[7] << 24);
    uint32_t h = (uint32_t)data[8] | ((uint32_t)data[9] << 8) | ((uint32_t)data[10] << 16) | ((uint32_t)data[11] << 24);
    if (w == 0 || h == 0 || w > 4096 || h > 4096) return BGT_E_INVALID;
    if ((uint64_t)w * h * 4u + 16u > len) return BGT_E_BOUNDS;
    out->width = w;
    out->height = h;
    out->rgba = data + 16;
    return BGT_OK;
}

#endif /* BGT_IMAGE_H */
