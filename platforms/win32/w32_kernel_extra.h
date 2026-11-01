/* Bounded browser process/volume contracts. No host processes, consoles or writable volume. MIT. */
static uint32_t k_fail(uint32_t error) { last_error = error; return 0; }
static uint32_t k_no_console(void) { return k_fail(6); }
static uint32_t k_no_process(void) { return k_fail(50); }
static uint32_t k_readonly_volume(void) { return k_fail(5); }
static struct { char name[128]; uint32_t value; } env_vars[64];
static uint32_t k_GetEnvironmentVariableW(void) {
    char name[128]; w32_gstr(ARG(0), 1, name, sizeof name);
    for (unsigned i=0;i<64;i++) if (env_vars[i].name[0] && w32_streqi(env_vars[i].name,name)) {
        uint32_t p=env_vars[i].value,n=0; while(x86_rd16(p+2*n))n++;
        if(ARG(2)<=n)return n+1;
        for(uint32_t j=0;j<=n;j++)x86_wr16(ARG(1)+2*j,x86_rd16(p+2*j));
        return n;
    }
    return k_fail(203);
}
static uint32_t k_SetEnvironmentVariableW(void) {
    char name[128]; w32_gstr(ARG(0),1,name,sizeof name);
    if(!name[0])return k_fail(87);
    for(unsigned j=0;name[j];j++)if(name[j]=='=')return k_fail(87);
    unsigned slot=64;
    for(unsigned i=0;i<64;i++)if(env_vars[i].name[0] && w32_streqi(env_vars[i].name,name)){slot=i;break;}
    if(!ARG(1)){if(slot<64){w32_heap_free(env_vars[slot].value);env_vars[slot].name[0]=0;env_vars[slot].value=0;}return 1;}
    if(slot==64)for(unsigned i=0;i<64;i++)if(!env_vars[i].name[0]){slot=i;break;}
    if(slot==64)return k_fail(8);
    uint32_t n=0;while(n<32767 && x86_rd16(ARG(1)+2*n))n++;
    if(n==32767)return k_fail(87);
    uint32_t p=w32_heap_alloc(2*(n+1),0);if(!p)return k_fail(8);
    for(uint32_t i=0;i<=n;i++)x86_wr16(p+2*i,x86_rd16(ARG(1)+2*i));
    w32_heap_free(env_vars[slot].value);env_vars[slot].value=p;
    unsigned i=0;do{env_vars[slot].name[i]=name[i];}while(name[i++]);return 1;
}
static uint32_t k_GetLogicalDrives(void) { return 4; } /* virtual C: */
static uint32_t k_GetUserDefaultUILanguage(void) { return 0x409; }
static uint32_t k_IsDBCSLeadByteEx(void) {
    unsigned cp=ARG(0),c=ARG(1)&255;
    if(cp==932)return (c>=0x81&&c<=0x9f)||(c>=0xe0&&c<=0xfc);
    if(cp==936||cp==949||cp==950)return c>=0x81&&c<=0xfe;
    if(cp==1361)return (c>=0x84&&c<=0xd3)||(c>=0xd8&&c<=0xde)||(c>=0xe0&&c<=0xf9);
    return 0; /* single-byte profile ANSI/OEM pages, UTF-8 has no DBCS lead bytes */
}
static uint32_t k_GetSystemPowerStatus(void) {
    uint32_t p=ARG(0);if(!p || !x86_mapped(p,12))return k_fail(87);
    x86_wr8(p,255);x86_wr8(p+1,255);x86_wr8(p+2,255);x86_wr8(p+3,0);
    x86_wr32(p+4,0xffffffffu);x86_wr32(p+8,0xffffffffu);return 1;
}
static uint32_t k_GetTimeZoneInformation(void) {
    uint32_t p=ARG(0);if(!p || !x86_mapped(p,172)){last_error=87;return 0xffffffffu;}
    for(unsigned i=0;i<172;i++)x86_wr8(p+i,0);
    w32_pstr(p+4,32,1,"UTC");w32_pstr(p+88,32,1,"UTC");return 0;
}
static uint32_t k_SystemTimeToFileTime(void) {
    uint32_t p=ARG(0),out=ARG(1);if(!p||!out||!x86_mapped(p,16)||!x86_mapped(out,8))return k_fail(87);
    int y=(int)x86_rd16(p),m=(int)x86_rd16(p+2),d=(int)x86_rd16(p+6);
    unsigned hh=x86_rd16(p+8),mm=x86_rd16(p+10),ss=x86_rd16(p+12),ms=x86_rd16(p+14);
    static const unsigned md[12]={31,28,31,30,31,30,31,31,30,31,30,31};
    int leap=y%4==0&&(y%100!=0||y%400==0);
    if(y<1601||y>30827||m<1||m>12||d<1||(unsigned)d>md[m-1]+(m==2?(unsigned)leap:0)||hh>23||mm>59||ss>59||ms>999)return k_fail(87);
    y-=m<=2;int era=y/400;unsigned yo=(unsigned)(y-era*400),mp=(unsigned)(m+(m>2?-3:9));
    int64_t days=(int64_t)era*146097+yo*365+yo/4-yo/100+(153*mp+2)/5+(unsigned)d-1-584694;
    uint64_t ft=((uint64_t)days*86400+hh*3600+mm*60+ss)*10000000+ms*10000;
    x86_wr64(out,ft);return 1;
}
static uint32_t k_LCIDToLocaleName(void) {
    if(ARG(0)!=0x409 && ARG(0)!=0x400 && ARG(0)!=0x800)return k_fail(87);
    if(!ARG(2))return 6;
    if(ARG(2)<6)return k_fail(122);
    w32_pstr(ARG(1),ARG(2),1,"en-US");return 6;
}
static uint32_t k_GetLocaleInfoEx(void) {
    char locale[64];if(ARG(0)){w32_gstr(ARG(0),1,locale,sizeof locale);if(locale[0]&&!w32_streqi(locale,"en-US"))return k_fail(87);}
    const char *s=0;
    switch(ARG(1)){case 0x5c:s="en-US";break;case 0x1004:s="1252";break;case 0xe:s=".";break;case 0xf:s=",";break;default:return k_fail(87);}
    uint32_t n=w32_slen(s)+1;if(!ARG(3))return n;if(ARG(3)<n)return k_fail(122);
    w32_pstr(ARG(2),ARG(3),1,s);return n;
}
/* Page protections are shared with the interpreter and lifted memory guards. Guard pages,
 * copy-on-write and cache modifiers require facilities not present in this single-process model. */
static uint32_t k_VirtualProtect(void) {
    uint64_t a=ARG64(0),n=ARG64(1),end=a+n;
    if(!n||end<a||end>0x100000000ull||!ARG(3)||!x86_mapped(ARG(3),4))return k_fail(87);
    uint64_t first=a&~4095ull,last=(end+4095)&~4095ull;
    if(last>0x100000000ull||!x86_mapped((uint32_t)first,(uint32_t)(last-first)))return k_fail(487);
    uint32_t prot=ARG(2);
    if(!memory_protection(prot))return k_fail(prot==8||prot==0x80||(prot&0x700)?50:87);
    uint32_t allocation,type,initial;uint64_t boundary;
    w32_memory_region((uint32_t)first,&allocation,&boundary,&type,&initial);
    if(last>boundary)return k_fail(487);
    if(!x86_accessible(ARG(3),4,2))return k_fail(998);
    uint32_t old=x86_protection[first>>12];if(!old)old=0x40;
    x86_wr32(ARG(3),old);
    for(uint32_t i=(uint32_t)(first>>12);i<last>>12;i++)x86_protection[i]=(uint8_t)prot;
    if(prot!=0x40)x86_protection_active=1;
    return 1;
}
static uint32_t k_VirtualQuery(void) {
    uint64_t a=ARG64(0),limit=0x100000000ull;
#ifdef X86_FLAT_GUEST
    limit=X86_FLAT_BYTES;
#endif
    uint32_t bytes=W32_64?48:28,p=ARG(1);
    if(a>=limit || ARG64(2)<bytes || !p || !x86_mapped(p,bytes))return k_fail(87);
    uint32_t base=(uint32_t)a&~4095u,first=base,type=0x20000;uint64_t boundary=limit,end=(uint64_t)base+4096;
    int mapped=x86_pages[base>>12]!=0;
    uint32_t prot=mapped?(x86_protection[base>>12]?x86_protection[base>>12]:0x40):0;
    uint32_t initial=0;
    if(mapped)w32_memory_region(base,&first,&boundary,&type,&initial);
    while(end<boundary && (x86_pages[end>>12]!=0)==mapped &&
        (!mapped || (x86_protection[end>>12]?x86_protection[end>>12]:0x40)==prot))end+=4096;
    for(uint32_t i=0;i<bytes;i++)x86_wr8(p+i,0);
    w32_wrptr(p,base);w32_wrptr(p+w32_ptr_size(),mapped?first:0);
    x86_wr32(p+2*w32_ptr_size(),initial);
    w32_wrptr(p+(W32_64?24:12),end-base);
    x86_wr32(p+(W32_64?32:16),mapped?0x1000:0x10000);
    x86_wr32(p+(W32_64?36:20),prot);
    x86_wr32(p+(W32_64?40:24),mapped?type:0);return bytes;
}
static uint32_t k_GetCurrentHwProfileA(void) { return k_fail(50); } /* no Windows hardware registry */
static uint32_t s_ShellExecuteW(void) { last_error=1155;return 31; } /* SE_ERR_NOASSOC */
static uint32_t s_SHGetKnownFolderPath(void) { if(ARG(3))w32_wrptr(ARG(3),0);return 0x80070002u; }
static uint32_t s_SHFileOperationW(void) { return 0x78; } /* DE_ACCESSDENIEDSRC */
static uint32_t s_DragQueryFileW(void) { last_error=6;return 0; }
static uint32_t s_DragAcceptFiles(void) { return 0; } /* void: no shell drop source exists */
static uint32_t m_midiInGetNumDevs(void) { return 0; }
static uint32_t m_midiInOpen(void) { if(ARG(0))w32_wrptr(ARG(0),0);return 2; } /* MMSYSERR_BADDEVICEID */
static uint32_t m_midiInGetDevCapsA(void) { return 2; }
static uint32_t m_midi_invalid(void) { return 5; } /* MMSYSERR_INVALHANDLE */
static uint32_t midi_period_refs[1001];
static uint32_t m_timeBeginPeriod(void) { uint32_t p=ARG(0);if(p<1||p>1000)return 97;midi_period_refs[p]++;return 0; }
static uint32_t m_timeEndPeriod(void) { uint32_t p=ARG(0);if(p<1||p>1000||!midi_period_refs[p])return 97;midi_period_refs[p]--;return 0; }
static uint32_t m_midiInGetErrorTextA(void) {
    static const char *const texts[]={"No error.","Unspecified error.","A device ID has been used that is out of range for your system.","The driver was not enabled.","The specified device is already in use.","The specified device handle is invalid."};
    if(!ARG(1)||!ARG(2))return 11;
    if(ARG(0)>=sizeof texts/sizeof texts[0]){x86_wr8(ARG(1),0);return 9;}
    w32_pstr(ARG(1),ARG(2),0,texts[ARG(0)]);return 0;
}
