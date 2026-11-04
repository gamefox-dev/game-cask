/* Original CC0-1.0: production context gate, without scheduling/consuming work. */
#define MODE64 1
#include "coverage_accounting.c"
#include "../../../platforms/win32/w32_thread.c"
/* This probe does not execute a scheduler; select the initial guest thread. */
uint32_t x86_current;
BGT_EXPORT(leaf_context) unsigned leaf_context(void) {
    prepare();
    __builtin_memset(threads,0,sizeof threads);yield_requested=0;
    if(!w32_thread_leaf_ready())return 1;
    X.callback_depth=1;if(w32_thread_leaf_ready()||X.callback_depth!=1)return 2;X.callback_depth=0;
    X.transfer=X86_SCHEDULE;if(w32_thread_leaf_ready()||X.transfer!=X86_SCHEDULE)return 3;X.transfer=0;
    for(unsigned k=SLEEPING;k<=ADDRESS_WAIT;k++){
        self()->kind=k;
        if(w32_thread_leaf_ready()||self()->kind!=k)return 4;
    }
    self()->kind=NONE;yield_requested=1;
    if(w32_thread_leaf_ready()||!yield_requested)return 5;
    yield_requested=0;self()->deferred=1;
    if(w32_thread_leaf_ready()||!self()->deferred)return 6;
    self()->deferred=0;
    return w32_thread_leaf_ready()?0:7;
}
