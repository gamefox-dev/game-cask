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
    cfiles[slot].buffer=0;cfiles[slot].user_buffer=0;cfiles[slot].begin=cfiles[slot].end=0;
    cfiles[slot].read=mode[0]=='r'||strchr(mode,'+')!=0;
    cfiles[slot].write=mode[0]!='r'||strchr(mode,'+')!=0;
    uint32_t token=iob_base+slot*48;cfile_sync(&cfiles[slot]);x86_wr32(token+28,ARG(0));return token;
}
static uint64_t c_close(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    int failed=file_flush(f);file_close_backend(f);return failed?UINT64_MAX:0;
}
static uint64_t c_read(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    uint32_t n=ARG(2);if(n>INT_MAX){crt_errno(22);return UINT64_MAX;}if(!n)return 0;
    if(!f->read){crt_errno(9);return UINT64_MAX;}
    if(file_descriptor(f))return UINT64_MAX;
    if(f->descriptor_eof)return 0;
    uint8_t *dst=cwmem(ARG(1),n),*raw=malloc(n>65536?65536:n);
    if(!raw){crt_errno(12);return UINT64_MAX;}
    uint32_t source=0,got=0;int failed=0;
    while(source<n){
        uint32_t want=n-source;if(want>65536)want=65536;
        uint32_t count=0;uint64_t start=f->pos;
        int ok=file_descriptor_read(f,raw,want,&count);
        if(f->handle)w32_file_consumed(f->handle,start,count);
        if(!ok){failed=1;break;}
        source+=count;
        for(uint32_t i=0;i<count;i++){
            int c=raw[i];
            if(!f->binary&&c==26){f->descriptor_eof=1;break;}
            if(!f->binary&&c=='\r'){
                if(i+1<count){if(raw[i+1]=='\n'){i++;c='\n';}}
                else {
                    uint8_t next;uint32_t extra=0;
                    if(!file_descriptor_read(f,&next,1,&extra)){failed=1;break;}
                    if(extra){
                        if(next=='\n'){if(f->handle)w32_file_consumed(f->handle,f->pos-1,1);c='\n';source++;}
                        else {f->pos--;if(f->handle){w32_file_observed(f->handle,f->pos,1);w32_file_seek_pos(f->handle,(int64_t)f->pos,0,0);}}
                    }
                }
            }
            dst[got++]=(uint8_t)c;
        }
        if(count<want||failed||f->descriptor_eof)break;
    }
    free(raw);if(failed){crt_errno(5);return UINT64_MAX;}return got;
}
static uint64_t c_write(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(ARG(2)>INT_MAX){crt_errno(22);return UINT64_MAX;}if(!ARG(2))return 0;
    if(!f->write){crt_errno(9);return UINT64_MAX;}
    if(file_descriptor(f))return UINT64_MAX;
    int mode=f->buffering,previous=f->error;f->buffering=-1;f->error=0;
    uint32_t n=file_write(f,cmem(ARG(1),ARG(2)),ARG(2));int failed=f->error;f->buffering=mode;f->error=previous;file_sync_aliases(f);
    return failed?UINT64_MAX:n;
}
static uint64_t c_lseeki64(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(file_descriptor(f)||file_seek(f,(int64_t)ARG64(1),ARG(2)))return UINT64_MAX;return file_tell(f);
}
static uint64_t c_lseek(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(file_descriptor(f)||file_seek(f,(int32_t)ARG(1),ARG(2)))return UINT64_MAX;
    uint64_t p=file_tell(f);if(p>INT32_MAX){crt_errno(22);return UINT64_MAX;}return p;
}
static uint64_t c_setmode(void) {
    crt_file_t *f=cfd(ARG(0));if(!f)return UINT64_MAX;
    if(ARG(1)!=0x8000&&ARG(1)!=0x4000){crt_errno(22);return UINT64_MAX;}
    if(file_flush(f))return UINT64_MAX;
    int old=f->binary?0x8000:0x4000;f->binary=ARG(1)==0x8000;return (uint64_t)old;
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
static uint64_t c_freopen_s(void) {
    uint32_t out=ARG(0);if(!out)return 22;x86_wr64(out,0);
    crt_file_t *old=cfile(ARG(3));if(!old||!ARG(1)||!ARG(2)){crt_errno(22);return 22;}
    /* Close and invalidate every alias even when opening the replacement fails. */
    file_flush(file_backend(old));file_close_backend(old);
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
    uint64_t n=print_wide_file(cfile(ARG(0)),&o);free(o.bytes);return n;
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

/* Hooks used by the shared VFS operations (rename/remove/rmdir/fstat) to reach CRT-owned mutable data. */
static int crt_key_under(const char *key,const char *root,int subtree) {
    size_t n=strlen(root);
    if(strncmp(key,root,n))return 0;
    return key[n]==0||(subtree&&key[n]=='/');
}
int w32_crt_files_busy(const char *key,int subtree) {
    for(unsigned i=0;i<64;i++)if(cfiles[i].open&&cfiles[i].node&&crt_key_under(cfiles[i].node->name,key,subtree))return 1;
    return 0;
}
void w32_crt_files_drop(const char *key) {
    for(crt_node_t **p=&file_nodes;*p;p=&(*p)->next)if(!strcmp((*p)->name,key)){
        crt_node_t *n=*p;*p=n->next;w32_heap_free(n->data);free(n);return;
    }
}
void w32_crt_files_rename(const char *from,const char *to) {
    size_t n=strlen(from);
    for(crt_node_t *c=file_nodes;c;c=c->next)if(crt_key_under(c->name,from,1)){
        char moved[512];strcpy(moved,to);strcat(moved,c->name+n);strcpy(c->name,moved);
    }
}
int w32_crt_fd_stat(int fd,w32_fs_info_t *info,int *chr) {
    crt_file_t *f=cfd((uint32_t)fd);if(!f)return 0;
    memset(info,0,sizeof *info);*chr=0;
    if(!f->node&&!f->handle){*chr=1;return 1;}
    if(f->node&&!w32_fs_key_info(f->node->name,info)){ /* anonymous tmpfile: no index entry */
        info->attrs=0x20;info->created=f->node->created;info->accessed=f->node->accessed;info->written=f->node->written;
    }
    if(f->handle){info->attrs=0x21;info->shipped=1;info->created=info->accessed=info->written=w32_fs_origin();}
    info->size=file_length(f);return 1;
}
