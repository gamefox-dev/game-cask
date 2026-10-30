/* Original CC0-1.0. Executed only after lifting to BGT, never as a host executable. */
#include <windows.h>
#include <emmintrin.h>
#include <stdarg.h>
#include <stdint.h>
int _tls_index;
static volatile uint64_t wide_a=0x1234567800000003ULL,wide_b=0xfedcba9800000005ULL;
static volatile int choose=5;
static volatile double source[4]={2,4,5,3};
static volatile int isource[8]={1,2,3,4,40,30,20,10};
extern int x64_table(int);
__declspec(noinline) static __m128d vector_math(__m128d a,__m128d b){return _mm_add_pd(_mm_mul_pd(a,b),a);}
__declspec(noinline) static __m128i vector_int(__m128i a,__m128i b){return _mm_shuffle_epi32(_mm_add_epi32(a,b),0x1b);}
static __m128d pd_result;static __m128i pi_result;static volatile double scalar_result;
static volatile long locked=4;
__declspec(noinline) static uint64_t mix(uint64_t a,uint64_t b){return ((a<<17)^(b>>11))+a*b;}
__declspec(noinline) static int table(int i){switch(i){case 0:return 91;case 1:return 17;case 2:return 73;case 3:return 39;case 4:return 105;case 5:return 62;case 6:return 28;default:return -1;}}
__declspec(noinline) static double sum(int n,...){va_list ap;va_start(ap,n);double v=0;for(int i=0;i<n;i++)v+=va_arg(ap,double);va_end(ap);return v;}
static uint64_t (*volatile function_pointer)(uint64_t,uint64_t)=mix;
void entry(void){
    uint64_t result=function_pointer(wide_a,wide_b);
    __m128d a=_mm_set_pd(source[1],source[0]),b=_mm_set_pd(source[3],source[2]);pd_result=vector_math(a,b);
    __m128i x=_mm_set_epi32(isource[3],isource[2],isource[1],isource[0]),y=_mm_set_epi32(isource[7],isource[6],isource[5],isource[4]);pi_result=vector_int(x,y);
    scalar_result=sum(5,1.25,2.5,3.75,4.0,5.5);
    InterlockedIncrement(&locked);
    uint64_t expected=((0x1234567800000003ULL<<17)^(0xfedcba9800000005ULL>>11))+0x1234567800000003ULL*0xfedcba9800000005ULL;
    double values[2];int ints[4];_mm_storeu_pd(values,pd_result);_mm_storeu_si128((__m128i*)ints,pi_result);
    int ok=result==expected && table(choose)==62 && x64_table(choose)==62 && values[0]==12 && values[1]==16 && ints[0]==14 && ints[3]==41 && scalar_result==17.0 && locked==5;
    char line[96];wsprintfA(line,"x64-basics result=%s table=%d",ok?"PASS":"FAIL",table(choose));OutputDebugStringA(line);
    for(;;)Sleep(5);
}
