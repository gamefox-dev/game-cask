/* Process-local owned kernel handles. SPDX-License-Identifier: MIT */
#ifndef W32_HANDLES_H
#define W32_HANDLES_H
/* Object identities outlive individual handles; FILE identities are released on last close. */
uint32_t w32_handle_file_new(uint32_t slot);
uint32_t w32_handle_key_new(uint32_t slot, uint32_t access);
uint32_t w32_handle_key(uint64_t h);
uint32_t w32_handle_file(uint64_t h);
void w32_file_destroy(uint32_t slot);
uint32_t w32_handle_console(uint32_t channel);
uint32_t w32_standard_handle(uint32_t channel);
int w32_thread_close_handle(uint64_t h);
void w32_thread_inherit_handle(uint64_t h, int inherit);
uint32_t w32_handle_console_channel(uint64_t h);
int w32_handle_access(uint64_t h, uint32_t rights);
int w32_handle_any_access(uint64_t h, uint32_t rights);
void w32_handle_file_access(uint64_t h, uint32_t access);
#endif
