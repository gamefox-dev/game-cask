/* MSVCRT descriptor/MinGW FILE and startup adapters. All FILEs share cfiles. MIT. */
static uint64_t c_iob_func(void) { return crt_iob_base(); }
static uint64_t c_lconv_init(void) {
    locale_init();
    /* __initialize_lconv_for_unsigned_char changes CHAR_MAX sentinel bytes to UCHAR_MAX. */
    for(unsigned i=0;i<8;i++)x86_wr8(lconv_cell+80+i,255);return 0;
}
static uint64_t c_amsg_exit(void) { flush_stdout(); w32_log("guest CRT fatal runtime error"); w32_exit_guest(255); return 0; }
static crt_file_t *cfd(uint32_t fd) {
    crt_iob_base();if(fd<64&&cfiles[fd].open&&!cfiles[fd].owner)return &cfiles[fd];crt_errno(9);return 0;
}
static uint64_t c_fileno(void) { crt_file_t *f=cfile(ARG(0));if(!f){crt_errno(9);return UINT64_MAX;}return (uint64_t)(file_backend(f)-cfiles); }
static uint64_t c_fdopen(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return 0;
    const char *mode=cstr(ARG(1));
    if(!strchr("rwa",mode[0])||!mode[0]){crt_errno(22);return 0;}
    if((mode[0]=='r'&&!f->read)||(mode[0]!='r'&&!f->write)||(strchr(mode,'+')&&(!f->read||!f->write))){crt_errno(13);return 0;}
    unsigned slot;for(slot=3;slot<64&&cfiles[slot].open;slot++){}
    if(slot==64){crt_errno(24);return 0;}
    cfiles[slot]=*f;cfiles[slot].owner=(int)ARG(0)+1;
    cfiles[slot].read=mode[0]=='r'||strchr(mode,'+')!=0;
    cfiles[slot].write=mode[0]!='r'||strchr(mode,'+')!=0;
    uint32_t token=iob_base+slot*48;cfile_sync(&cfiles[slot]);x86_wr32(token+28,ARG(0));return token;
}
static uint64_t c_close(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    file_close_backend(f);return 0;
}
static uint64_t c_read(void) { crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;if(ARG(2)>INT_MAX){crt_errno(22);return UINT64_MAX;}if(!f->read){crt_errno(9);return UINT64_MAX;}int previous=f->error;f->error=0;uint32_t got=file_read(f,cwmem(ARG(1),ARG(2)),ARG(2));int failed=f->error;f->error|=previous;return failed?UINT64_MAX:got; }
static uint64_t c_write(void) { crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;if(ARG(2)>INT_MAX){crt_errno(22);return UINT64_MAX;}if(!f->write){crt_errno(9);return UINT64_MAX;}uint32_t n=file_write(f,cmem(ARG(1),ARG(2)),ARG(2));return f->error?UINT64_MAX:n; }
static uint64_t c_lseeki64(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(file_seek(f,(int64_t)ARG64(1),ARG(2)))return UINT64_MAX;return file_tell(f);
}
static uint64_t file_length(crt_file_t *f) {
    if(!f)return UINT64_MAX;
    uint64_t size=0;if(f->handle){if(!w32_file_size_get(f->handle,&size)){crt_errno(9);return UINT64_MAX;}}
    else if(f->node)size=f->node->size;return size;
}
static uint64_t c_filelengthi64(void) { return file_length(cfd(ARG(0))); }
static uint64_t c_get_osfhandle(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(f->handle)return f->handle;
    if(ARG(0)<3)return w32_standard_handle(3-ARG(0));
    crt_errno(9);return UINT64_MAX; /* process-memory temp files have no kernel handle */
}
static uint64_t c_getpid(void) { return 1; }
static uint64_t c_wfsopen(void) { if(ARG(2)!=0x10&&ARG(2)!=0x20&&ARG(2)!=0x30&&ARG(2)!=0x40){crt_errno(22);return 0;}if(ARG(2)!=0x40){crt_errno(13);return 0;}return file_open(1,0); }
static uint64_t stat_file(crt_file_t *f,uint32_t out) {
    if(!f)return UINT64_MAX;if(!out){crt_errno(22);return UINT64_MAX;}
    memset(cwmem(out,56),0,56);
    x86_wr16(out+6,((f->node||f->handle)?0x8000:0x2000)|((f->node||f->handle||f->read)?0x100:0)|((f->node||f->write)?0x80:0));x86_wr16(out+8,1);
    x86_wr64(out+24,file_length(f));return 0;
}
static uint64_t c_fstat64(void) { return stat_file(cfd(ARG(0)),ARG(1)); }
static uint64_t c_wstat64(void) {
    char name[512];w32_gstr(ARG(0),1,name,sizeof name);w32_fs_normalize(name,name);
    for(crt_node_t *n=file_nodes;n;n=n->next)if(!strcmp(n->name,name)){crt_file_t f={0};f.node=n;return stat_file(&f,ARG(1));}
    uint32_t handle=w32_file_open_str(name,0);if(!handle){crt_errno(2);return UINT64_MAX;}
    crt_file_t f={0};f.handle=handle;uint64_t result=stat_file(&f,ARG(1));w32_file_close_h(handle);return result;
}
static uint64_t remove_file(int wide) {
    char name[512];w32_gstr(ARG(0),wide,name,sizeof name);w32_fs_normalize(name,name);
    for(crt_node_t **p=&file_nodes;*p;p=&(*p)->next)if(!strcmp((*p)->name,name)){
        crt_node_t *n=*p;for(unsigned i=0;i<64;i++)if(cfiles[i].open&&cfiles[i].node==n){crt_errno(13);return UINT64_MAX;}
        *p=n->next;w32_fs_remove(name);w32_heap_free(n->data);free(n);return 0;
    }
    uint32_t h=w32_file_open_str(name,0);if(h){w32_file_close_h(h);crt_errno(13);}else crt_errno(2);return UINT64_MAX;
}
static uint64_t c_remove(void) { return remove_file(0); }
static uint64_t c_wunlink(void) { return remove_file(1); }
static uint64_t c_wrename(void) {
    char a[512],b[512];w32_gstr(ARG(0),1,a,sizeof a);w32_gstr(ARG(1),1,b,sizeof b);w32_fs_normalize(a,a);w32_fs_normalize(b,b);
    for(crt_node_t *n=file_nodes;n;n=n->next)if(!strcmp(n->name,b)){crt_errno(17);return UINT64_MAX;}
    uint32_t h=w32_file_open_str(b,0);if(h){w32_file_close_h(h);crt_errno(17);return UINT64_MAX;}
    for(crt_node_t *n=file_nodes;n;n=n->next)if(!strcmp(n->name,a)){w32_fs_remove(a);strcpy(n->name,b);w32_fs_update(b,n->size);return 0;}
    h=w32_file_open_str(a,0);if(h){w32_file_close_h(h);crt_errno(13);}else crt_errno(2);return UINT64_MAX;
}
static uint64_t c_wchdir(void) {
    char name[512];w32_gstr(ARG(0),1,name,sizeof name);
    if(w32_streqi(name,"C:\\GAME")||w32_streqi(name,"C:\\GAME\\")||!strcmp(name,"."))return 0;
    crt_errno(2);return UINT64_MAX;
}
static uint64_t c_wrmdir(void) { crt_errno(13);return UINT64_MAX; } /* shipped volume readonly */
static uint64_t c_freopen_s(void) {
    uint32_t out=ARG(0);if(!out)return 22;x86_wr64(out,0);
    crt_file_t *old=cfile(ARG(3));if(!old||!ARG(1)||!ARG(2)){crt_errno(22);return 22;}
    /* Close and invalidate every alias even when opening the replacement fails. */
    file_close_backend(old);
    /* Keep argument homes/registers intact; file_open consumes the name/mode pair. */
    uint64_t a=X.r[ECX],b=X.r[EDX];X.r[ECX]=ARG64(1);X.r[EDX]=ARG64(2);
    uint64_t token=file_open(0,0);X.r[ECX]=a;X.r[EDX]=b;
    if(!token)return x86_rd32(crt_errno_cell());
    crt_file_t *fresh=cfile((uint32_t)token);if(fresh!=old){*old=*fresh;memset(fresh,0,sizeof *fresh);}
    uint32_t slot=(uint32_t)(old-cfiles);cfile_sync(old);x86_wr32(iob_base+slot*48+28,slot);
    x86_wr64(out,iob_base+slot*48);return 0;
}
static uint64_t c_scprintf(void) { return crt_vformat(0,0,ARG(0),direct_va(1),0,2); }
static uint64_t c_vscprintf(void) { return crt_vformat(0,0,ARG(0),ARG(1),0,2); }
static uint64_t c_vsnprintf_s(void) {
    uint32_t dst=ARG(0);uint64_t cap=ARG64(1),count=ARG64(2);
    if(!dst||!cap||!ARG(3)){crt_errno(22);return UINT64_MAX;}
    format_out_t o=format_guest(ARG(3),ARG(4),0,0);
    if(o.error){free(o.bytes);x86_wr8(dst,0);crt_errno(22);return UINT64_MAX;}
    if(count!=UINT64_MAX && count>=cap && o.n>=cap){free(o.bytes);x86_wr8(dst,0);crt_errno(34);return UINT64_MAX;}
    uint64_t n=o.n;if(n>count)n=count;if(n>=cap)n=cap-1;
    if(n)memcpy(cwmem(dst,(uint32_t)n),o.bytes,(size_t)n);x86_wr8(dst+(uint32_t)n,0);
    uint64_t result=n<o.n?UINT64_MAX:n;free(o.bytes);return result;
}
static uint64_t c_fwprintf(void) {
    format_out_t o=format_guest(ARG(1),direct_va(2),1,4);
    uint64_t n=o.error?UINT64_MAX:file_write(cfile(ARG(0)),(const uint8_t *)o.bytes,(uint32_t)o.n);
    if(n!=UINT64_MAX)n=utf16_units(o.bytes,o.n);free(o.bytes);return n;
}
static uint64_t c_ultoa(void) {
    unsigned base=ARG(2);if(base<2||base>36){crt_errno(22);return 0;}
    char buf[33];unsigned n=0;uint32_t v=ARG(0);do{unsigned d=v%base;buf[n++]=(char)(d<10?'0'+d:'a'+d-10);v/=base;}while(v);
    for(unsigned i=0;i<n;i++)x86_wr8(ARG(1)+i,(uint8_t)buf[n-i-1]);x86_wr8(ARG(1)+n,0);return ARG(1);
}
static uint64_t secure_copy(int wide) {
    uint32_t dst=ARG(0);uint64_t cap=ARG64(1);unsigned step=wide?2:1;
    if(!dst||!cap||!ARG(2)){if(dst&&cap)swr(dst,(unsigned)wide,0);crt_errno(22);return 22;}
    uint64_t n=0;while(sch(ARG(2)+(uint32_t)n*step,(unsigned)wide))n++;
    if(n>=cap){swr(dst,(unsigned)wide,0);crt_errno(34);return 34;}
    for(uint32_t i=0;i<=n;i++)swr(dst+i*step,(unsigned)wide,sch(ARG(2)+i*step,(unsigned)wide));return 0;
}
static uint64_t c_strcpy_s(void) { return secure_copy(0); }
static uint64_t c_wcscpy_s(void) { return secure_copy(1); }
static uint64_t c_memicmp(void) {
    for(uint32_t i=0;i<ARG(2);i++){int a=tolower((int)x86_rd8(ARG(0)+i)),b=tolower((int)x86_rd8(ARG(1)+i));if(a!=b)return (uint64_t)(int64_t)(a-b);}return 0;
}
static uint64_t c_wcsftime(void) {
    struct tm t=tm_from_guest(ARG(3));char *fmt=utf16_string(ARG(2),-1);
    if(!fmt){crt_errno(12);return 0;}size_t cap=(size_t)ARG64(1);if(cap>UINT32_MAX){free(fmt);return 0;}
    if(cap>UINT32_MAX/4-1){free(fmt);crt_errno(22);return 0;}
    size_t bytecap=cap*4+1;char *buf=malloc(bytecap);if(!buf){free(fmt);crt_errno(12);return 0;}
    size_t n=strftime(buf,bytecap,fmt,&t),units=utf16_units(buf,n);
    if(!n||units>=cap){free(buf);free(fmt);return 0;}
    size_t at=0;uint32_t written=0;
    while(at<n){unsigned c=utf8_next(buf,n,&at);if(c>65535){c-=65536;x86_wr16(ARG(0)+2*written++,0xd800|(c>>10));c=0xdc00|(c&1023);}x86_wr16(ARG(0)+2*written++,c);}
    x86_wr16(ARG(0)+2*written,0);free(buf);free(fmt);return units;
}
static uint64_t c_perror(void) {
    crt_iob_base();const char *prefix=ARG(0)?cstr(ARG(0)):"";
    const char *s=errstr(x86_rd32(crt_errno_cell()));
    if(*prefix){file_write(&cfiles[2],(const uint8_t *)prefix,(uint32_t)strlen(prefix));file_write(&cfiles[2],(const uint8_t *)": ",2);}
    file_write(&cfiles[2],(const uint8_t *)s,(uint32_t)strlen(s));file_write(&cfiles[2],(const uint8_t *)"\n",1);return 0;
}
