/* SPDX-License-Identifier: MIT */
#ifndef W32_COM_H
#define W32_COM_H
#include "w32_int.h"
enum { WCOM_ENUM = 1, WCOM_DEVICE, WCOM_AUDIO, WCOM_RENDER };
typedef struct {
    uint32_t addr, refs, kind, state, parent;
} w32_com_object_t;
w32_com_object_t *w32_com_object(uint32_t addr);
uint32_t w32_com_new(uint32_t kind, uint32_t state, uint32_t parent);
uint32_t w32_com_release(uint32_t addr);
int w32_com_guid(uint32_t addr, const uint32_t words[4]);
extern const uint32_t w32_iid_enum[4], w32_iid_device[4], w32_iid_audio[4], w32_iid_render[4];
extern const w32_api_t w32_api_com[];
extern const uint32_t w32_api_com_n;
#endif
