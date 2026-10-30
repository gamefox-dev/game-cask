/* Original CC0. Materialize every byte, then verify both page boundaries and interior bytes. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#endif
int main(void) {
    const size_t bytes = (size_t)600 * 1024 * 1024;
    unsigned char *p = malloc(bytes);
    if (!p) { puts("memory FAIL allocation"); return 1; }
    memset(p, 0xa5, bytes);
    uint64_t checksum = 0;
    for (size_t off = 0; off < bytes; off += 4096) {
        if (p[off] != 0xa5 || p[off + 17] != 0xa5 || p[off + 4095] != 0xa5) {
            puts("memory FAIL contents"); return 2;
        }
        p[off + 17] = (unsigned char)(off / 4096);
        checksum += p[off] + p[off + 17] + p[off + 4095];
    }
    for (size_t off = 0; off < bytes; off += 4096) {
        if (p[off + 17] != (unsigned char)(off / 4096)) { puts("memory FAIL pattern"); return 3; }
    }
    printf("memory PASS bytes=%llu pages=%llu checksum=%llu alignment=%u\n",
           (unsigned long long)bytes, (unsigned long long)(bytes / 4096),
           (unsigned long long)checksum, (unsigned)((uintptr_t)p & 15));
    free(p);
#ifdef _WIN32
    /* Also exercise the upper edge of a 2 GiB guest window without eagerly touching that space. */
    volatile unsigned char *edge = VirtualAlloc((void *)(uintptr_t)0x7ffe0000, 65536, MEM_COMMIT | MEM_RESERVE,
                                               PAGE_READWRITE);
    if (!edge) { puts("memory FAIL window-edge"); return 4; }
    edge[0] = 0x5a; edge[65535] = 0xc3;
    if (edge[0] != 0x5a || edge[65535] != 0xc3) { puts("memory FAIL edge-contents"); return 5; }
    puts("memory window-edge=2147418111 PASS");
#endif
    return 0;
}
