/* CC0 fixture adapter: musl's stack-cookie entropy never imports a host service.
 * This is not guest entropy and does not claim cryptographic security. */
#include <wasi/api.h>
__wasi_errno_t __wasi_random_get(uint8_t *p,__wasi_size_t n){
    for(__wasi_size_t i=0;i<n;i++)p[i]=(uint8_t)(0xa5u+i);
    return 0;
}
