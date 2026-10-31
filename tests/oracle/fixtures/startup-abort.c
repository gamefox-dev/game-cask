/* SPDX-License-Identifier: CC0-1.0
 * Original synthetic fixture: abort before the first guest update completes.
 * Never executed on the host; compiled to PE and run only by the kit.
 */
#include <windows.h>
int _tls_index;
static const char *volatile crt_name = "msvcrt.dll"; /* retain a genuine DIR64 relocation */
void entry(void) {
    void (*guest_abort)(void) = (void (*)(void))GetProcAddress(LoadLibraryA(crt_name), "abort");
    guest_abort();
}
