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
/* Search handles retain their pattern and cursor over the manifest/CRT VFS index; the CRT's _findfirst
 * family uses the very same handles and matching. Non-root directories start with "." and ".." as on Windows. */
typedef struct { char name[260]; uint32_t attrs; uint64_t size, created, accessed, written; } find_entry_t;
static struct { int open; char pattern[512]; fs_node_t *next; unsigned dots; uint64_t dir_times[2][3]; } find_files[64];
static int file_match(const char *pattern,const char *s) {
    const char *star=0,*retry=0;
    if(w32_streqi(pattern,"*.*"))pattern="*";
    while(*s){
        char a=*pattern,b=*s;if(a>='A'&&a<='Z')a=(char)(a+32);if(b>='A'&&b<='Z')b=(char)(b+32);
        if(a=='?'||(a==b&&a)){pattern++;s++;continue;}
        if(a=='*'){star=++pattern;retry=s;continue;}
        if(star){pattern=star;s=++retry;continue;}return 0;
    }
    while(*pattern=='*')pattern++;
    /* Windows also matches an extensionless name against name.*. */
    if(pattern[0]=='.'&&pattern[1]=='*'&&!pattern[2])pattern+=2;
    return !*pattern;
}
static int find_take(unsigned slot,find_entry_t *e) {
    char parent[512];unsigned last=0,i=0;
    do{parent[i]=find_files[slot].pattern[i];if(parent[i]=='/')last=i+1;}while(parent[i++]);
    const char *pattern=find_files[slot].pattern+last;parent[last?last-1:0]=0;
    while(find_files[slot].dots<2){
        unsigned d=find_files[slot].dots++;
        if(!parent[0])continue; /* the volume root has neither */
        const char *dot=d?"..":".";
        if(!file_match(pattern,dot))continue;
        e->name[0]='.';e->name[1]=d?'.':0;e->name[2]=0;e->attrs=0x10;e->size=0;
        e->created=find_files[slot].dir_times[d][0];e->accessed=find_files[slot].dir_times[d][1];e->written=find_files[slot].dir_times[d][2];
        return 1;
    }
    for(fs_node_t *n=find_files[slot].next;n;n=n->next){
        find_files[slot].next=n->next;if(!n->live)continue;
        const char *name=n->name;unsigned j=0;
        if(last){while(j<last-1&&name[j]==parent[j])j++;if(j!=last-1||name[j]!='/')continue;name+=last;}
        int slash=0;for(j=0;name[j];j++)if(name[j]=='/')slash=1;
        if(slash||!file_match(pattern,name))continue;
        for(j=0;n->disp[j]&&j<259;j++)e->name[j]=n->disp[j];e->name[j]=0;
        e->attrs=n->attributes;e->size=n->size;e->created=n->created;e->accessed=n->accessed;e->written=n->written;
        return 1;
    }
    return 0;
}
static void find_write_w(const find_entry_t *e,uint32_t out) {
    for(unsigned i=0;i<592;i++)x86_wr8(out+i,0);
    x86_wr32(out,e->attrs);
    x86_wr32(out+4,(uint32_t)e->created);x86_wr32(out+8,(uint32_t)(e->created>>32));
    x86_wr32(out+12,(uint32_t)e->accessed);x86_wr32(out+16,(uint32_t)(e->accessed>>32));
    x86_wr32(out+20,(uint32_t)e->written);x86_wr32(out+24,(uint32_t)(e->written>>32));
    x86_wr32(out+28,(uint32_t)(e->size>>32));x86_wr32(out+32,(uint32_t)e->size);
    w32_pstr(out+44,260,1,e->name);
}
/* Returns 0 and the first entry, or a Win32 error. */
static uint32_t find_begin(const char *raw,unsigned *slot_out,find_entry_t *first) {
    fs_init();if(!raw[0])return 3;
    fs_path_t pv,*p=&pv;fs_resolve(raw,p);
    if(p->toolong)return 206;if(p->invalid||p->foreign)return p->foreign?3:123;
    if(p->trailing)return 2; /* INFERRED error: FindFirstFile search names must not end in a separator */
    unsigned slot;for(slot=0;slot<64&&find_files[slot].open;slot++){}
    if(slot==64)return 4;
    unsigned i=0;do{find_files[slot].pattern[i]=p->key[i];}while(p->key[i++]);
    find_files[slot].next=fs_nodes;find_files[slot].dots=0;
    for(unsigned d=0;d<2;d++)for(unsigned t=0;t<3;t++)find_files[slot].dir_times[d][t]=filetime_origin();
    if(p->key_parent){
        char parent[512];for(i=0;i<p->key_parent;i++)parent[i]=p->key[i];parent[p->key_parent]=0;
        fs_node_t *d=fs_lookup(parent);
        if(!d||!(d->attributes&0x10))return 3;
        find_files[slot].dir_times[0][0]=d->created;find_files[slot].dir_times[0][1]=d->accessed;find_files[slot].dir_times[0][2]=d->written;
        unsigned end=p->key_parent;while(end&&parent[end-1]!='/')end--;
        parent[end?end-1:0]=0;d=parent[0]?fs_lookup(parent):0;
        if(d){find_files[slot].dir_times[1][0]=d->created;find_files[slot].dir_times[1][1]=d->accessed;find_files[slot].dir_times[1][2]=d->written;}
    }
    if(!find_take(slot,first))return 2;
    find_files[slot].open=1;*slot_out=slot;return 0;
}
static uint32_t find_first(uint32_t src,uint32_t out) {
    char raw[520];w32_gstr(src,1,raw,sizeof raw);
    if(!out||!x86_accessible(out,592,2)){last_error=87;return 0xffffffffu;}
    unsigned slot;find_entry_t e;uint32_t err=find_begin(raw,&slot,&e);
    if(err){last_error=err;return 0xffffffffu;}
    find_write_w(&e,out);return 0x120000+slot;
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
    find_entry_t e;if(!find_take(slot,&e))return k_fail(18);
    find_write_w(&e,ARG(1));return 1;
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
