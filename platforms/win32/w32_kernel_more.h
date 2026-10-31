/* Remaining bounded kernel contracts. Unsupported facilities fail, not success stubs. MIT. */
static uint32_t s_CommandLineToArgvW(void) {
    uint32_t src=ARG(0),argc_out=ARG(1),n=0;
    if(!argc_out)return k_fail(87);
    if(!src)return k_fail(87);
    while(x86_rd16(src+2*n)){if(++n>32767)return k_fail(87);}
    if(!n){src=w32_get_cmdline(1);while(x86_rd16(src+2*n))n++;}
    uint32_t ptrbytes=(n+2)*w32_ptr_size(),base=w32_heap_alloc(ptrbytes+2*(n+2),1);
    if(!base)return k_fail(8);
    uint32_t out=base+ptrbytes,argc=0,i=0;
    for(;;){
        w32_wrptr(base+argc++*w32_ptr_size(),out);int quote=0;
        for(;;){
            unsigned c=x86_rd16(src+2*i);
            if(!c||(!quote&&(c==' '||c=='\t')))break;
            unsigned slashes=0;while(x86_rd16(src+2*i)=='\\'){slashes++;i++;}
            c=x86_rd16(src+2*i);
            if(c=='\"'){
                for(unsigned j=0;j<slashes/2;j++){x86_wr16(out,'\\');out+=2;}
                if(slashes&1){x86_wr16(out,'\"');out+=2;i++;}
                else if(quote&&x86_rd16(src+2*(i+1))=='\"'){x86_wr16(out,'\"');out+=2;i+=2;}
                else{quote=!quote;i++;}
            }else{
                for(unsigned j=0;j<slashes;j++){x86_wr16(out,'\\');out+=2;}
                if(c && (quote||(c!=' '&&c!='\t'))){x86_wr16(out,c);out+=2;i++;}
            }
        }
        x86_wr16(out,0);out+=2;
        while(x86_rd16(src+2*i)==' '||x86_rd16(src+2*i)=='\t')i++;
        if(!x86_rd16(src+2*i))break;
    }
    x86_wr32(argc_out,argc);return base;
}
/* Owned handles/process queries are dispatched by the shared scheduler registry. */
static uint32_t k_FormatMessageW(void) {
    uint32_t flags=ARG(0),id=ARG(2),out=ARG(4),cap=ARG(5);const char *text=0;
    if(!(flags&0x1000)||flags&0x400)return k_fail(87); /* system messages, not arbitrary module resources */
    if(ARG(3)!=0 && ARG(3)!=0x409)return k_fail(1815);
    switch(id){case 0:text="The operation completed successfully.\r\n";break;
    case 2:text="The system cannot find the file specified.\r\n";break;
    case 3:text="The system cannot find the path specified.\r\n";break;
    case 5:text="Access is denied.\r\n";break;
    case 6:text="The handle is invalid.\r\n";break;
    case 8:text="Not enough memory resources are available to process this command.\r\n";break;
    case 50:text="The request is not supported.\r\n";break;
    case 87:text="The parameter is incorrect.\r\n";break;
    case 122:text="The data area passed to a system call is too small.\r\n";break;
    case 126:text="The specified module could not be found.\r\n";break;
    case 127:text="The specified procedure could not be found.\r\n";break;
    default:return k_fail(317);}
    uint32_t n=w32_slen(text);if(flags&0x100){uint32_t count=imax((int32_t)cap,(int32_t)n+1);uint32_t p=w32_heap_alloc(count*2,0);if(!p)return k_fail(8);w32_wrptr(out,p);out=p;cap=count;}
    if(cap<=n)return k_fail(122);w32_pstr(out,cap,1,text);return n;
}
/* Search handles retain their pattern and cursor over the manifest/CRT VFS index. */
static struct { int open; char pattern[512]; fs_node_t *next; } find_files[64];
static int file_match(const char *pattern,const char *s) {
    const char *star=0,*retry=0;
    if(w32_streqi(pattern,"*.*"))pattern="*";
    while(*s){
        if(*pattern=='?'||*pattern==*s){pattern++;s++;continue;}
        if(*pattern=='*'){star=++pattern;retry=s;continue;}
        if(star){pattern=star;s=++retry;continue;}return 0;
    }
    while(*pattern=='*')pattern++;
    /* Windows also matches an extensionless name against name.*. */
    if(pattern[0]=='.'&&pattern[1]=='*'&&!pattern[2])pattern+=2;
    return !*pattern;
}
static int find_emit(unsigned slot,uint32_t out) {
    char parent[512];unsigned last=0,i=0;
    do{parent[i]=find_files[slot].pattern[i];if(parent[i]=='/')last=i+1;}while(parent[i++]);
    const char *pattern=find_files[slot].pattern+last;parent[last?last-1:0]=0;
    for(fs_node_t *n=find_files[slot].next;n;n=n->next){
        find_files[slot].next=n->next;if(!n->live)continue;
        const char *name=n->name;unsigned j=0;
        if(last){while(j<last-1&&name[j]==parent[j])j++;if(j!=last-1||name[j]!='/')continue;name+=last;}
        int slash=0;for(j=0;name[j];j++)if(name[j]=='/')slash=1;
        if(slash||!file_match(pattern,name))continue;
        for(i=0;i<592;i++)x86_wr8(out+i,0);
        x86_wr32(out,n->attributes);x86_wr32(out+28,(uint32_t)(n->size>>32));x86_wr32(out+32,(uint32_t)n->size);
        w32_pstr(out+44,260,1,name);return 1;
    }
    return 0;
}
static uint32_t find_first(uint32_t src,uint32_t out) {
    fs_init();char raw[512],path[512];w32_gstr(src,1,raw,sizeof raw);w32_fs_normalize(raw,path);
    if(!out||!x86_accessible(out,592,2)){last_error=87;return 0xffffffffu;}
    unsigned slot;for(slot=0;slot<64&&find_files[slot].open;slot++){}
    if(slot==64){last_error=4;return 0xffffffffu;}
    unsigned i=0;do{find_files[slot].pattern[i]=path[i];}while(path[i++]);
    find_files[slot].next=fs_nodes;
    if(!find_emit(slot,out)){last_error=2;return 0xffffffffu;}
    find_files[slot].open=1;return 0x120000+slot;
}
static uint32_t k_FindFirstFileW(void) { return find_first(ARG(0),ARG(1)); }
static uint32_t k_FindFirstFileExW(void) {
    if(ARG(1)>1||ARG(3)!=0||ARG(5)&~2u){last_error=87;return 0xffffffffu;}
    return find_first(ARG(0),ARG(2));
}
static uint32_t k_FindNextFileW(void) {
    uint32_t slot=ARG(0)-0x120000;
    if(slot>=64||!find_files[slot].open)return k_fail(6);
    if(!ARG(1)||!x86_accessible(ARG(1),592,2))return k_fail(87);
    return find_emit(slot,ARG(1))?1:k_fail(18);
}
static uint32_t k_FindClose(void) {
    uint32_t slot=ARG(0)-0x120000;if(slot>=64||!find_files[slot].open)return k_fail(6);
    find_files[slot].open=0;return 1;
}
static uint32_t k_GetTempFileNameW(void) {
    /* Nonzero uUnique only constructs a name; it must not create a file. */
    if(!ARG(2))return k_fail(5); /* kernel volume has no writable temp directory */
    char path[512],prefix[8],result[540];w32_gstr(ARG(0),1,path,sizeof path);w32_gstr(ARG(1),1,prefix,sizeof prefix);
    if(!w32_streqi(path,"C:\\GAME")&&!w32_streqi(path,"C:\\GAME\\"))return k_fail(3);
    uint32_t n=w32_slen(path);if(n && path[n-1]!='\\')path[n++]='\\';path[n]=0;
    uint32_t j=0;while(j<n){result[j]=path[j];j++;}
    for(unsigned i=0;i<3&&prefix[i];i++)result[j++]=prefix[i];
    unsigned unique=ARG(2)&65535;static const char digits[]="0123456789ABCDEF";
    for(int shift=12;shift>=0;shift-=4)result[j++]=digits[(unique>>(unsigned)shift)&15];
    result[j++]='.';result[j++]='t';result[j++]='m';result[j++]='p';result[j]=0;
    if(j>=260)return k_fail(206);w32_pstr(ARG(3),260,1,result);return ARG(2);
}
