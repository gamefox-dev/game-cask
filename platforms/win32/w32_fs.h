/* Process-local VFS directory index; shipped entries come from the build manifest. MIT. */
typedef struct fs_node { struct fs_node *next; char name[512]; uint64_t size; uint32_t attributes; int live,shipped; } fs_node_t;
static fs_node_t *fs_nodes;
static int fs_ready;
void w32_fs_normalize(const char *raw,char *out) {
    const char *s=raw;unsigned n=0;int absolute=0;
    if((s[0]=='C'||s[0]=='c')&&s[1]==':'){s+=2;absolute=1;}
    while(*s=='/'||*s=='\\')s++;
    if(absolute&&(s[0]=='g'||s[0]=='G')&&(s[1]=='a'||s[1]=='A')&&(s[2]=='m'||s[2]=='M')&&(s[3]=='e'||s[3]=='E')&&(!s[4]||s[4]=='/'||s[4]=='\\')){s+=4;while(*s=='/'||*s=='\\')s++;}
    while(*s&&n<511){if(s[0]=='.'&&(s[1]=='/'||s[1]=='\\')){s+=2;continue;}char c=*s++;out[n++]=c=='\\'?'/':c>='A'&&c<='Z'?(char)(c+32):c;}
    while(n&&out[n-1]=='/')n--;out[n]=0;if(n==1&&out[0]=='.')out[0]=0;
}
static fs_node_t *fs_lookup(const char *name) { for(fs_node_t *n=fs_nodes;n;n=n->next)if(n->live&&w32_streqi(n->name,name))return n;return 0; }
static void fs_put(const char *name,uint64_t size,uint32_t attr,int shipped) {
    fs_node_t *n=fs_lookup(name);
    if(!n){n=x86_alloc(sizeof *n);if(!n)x86_fault("VFS index exhausted",0);unsigned i=0;do{n->name[i]=name[i];}while(name[i++]);n->next=fs_nodes;fs_nodes=n;}
    n->size=size;n->attributes=attr;n->live=1;n->shipped=shipped;
}
static void fs_add(const char *raw,uint64_t size,uint32_t attr,int shipped) {
    char path[512];w32_fs_normalize(raw,path);if(!path[0])return;
    for(unsigned i=0;path[i];i++)if(path[i]=='/'){path[i]=0;if(!fs_lookup(path))fs_put(path,0,0x10,shipped);path[i]='/';}
    fs_put(path,size,attr,shipped);
}
static void fs_init(void) {
    if(fs_ready)return;fs_ready=1;
    const char *path="bgt-file-index.txt";int32_t h=bgt_asset_open(path,w32_slen(path));if(h<0)return;
    char line[560];unsigned used=0;uint8_t buf[1024];int32_t count;
    while((count=bgt_asset_read(h,buf,sizeof buf))>0)for(int32_t i=0;i<count;i++){
        if(buf[i]=='\n'){line[used]=0;uint64_t size=0;unsigned j=0;while(line[j]>='0'&&line[j]<='9')size=size*10+(unsigned)(line[j++]-'0');if(line[j]=='\t')fs_add(line+j+1,size,0x21,1);used=0;}
        else if(used+1<sizeof line)line[used++]=(char)buf[i];
    }
    bgt_asset_close(h);
}
/* Shared metadata query: no kernel/CRT file or search slot is consumed. */
int w32_fs_query(const char *raw,uint32_t *attrs) {
    if(!raw[0])return 0;
    fs_init();char path[512];w32_fs_normalize(raw,path);
    if(!path[0]){if(attrs)*attrs=0x10;return 1;} /* virtual C:\\GAME root */
    fs_node_t *n=fs_lookup(path);if(!n)return 0;
    if(attrs)*attrs=n->attributes;return 1;
}
void w32_fs_update(const char *raw,uint64_t size) { fs_init();fs_add(raw,size,0x20,0); }
void w32_fs_remove(const char *raw) { fs_init();char path[512];w32_fs_normalize(raw,path);fs_node_t *n=fs_lookup(path);if(n&&!n->shipped)n->live=0; }
static uint32_t k_CreateDirectoryW(void) {
    fs_init();char raw[512],path[512];w32_gstr(ARG(0),1,raw,sizeof raw);w32_fs_normalize(raw,path);
    if(!path[0]||fs_lookup(path)){last_error=183;return 0;}
    char parent[512];unsigned i=0,last=0;do{parent[i]=path[i];if(path[i]=='/')last=i;}while(path[i++]);
    if(last){parent[last]=0;fs_node_t *n=fs_lookup(parent);if(!n||!(n->attributes&0x10)){last_error=3;return 0;}}
    fs_put(path,0,0x10,0);return 1;
}
static uint32_t k_DeleteFileW(void) {
    fs_init();char raw[512],path[512];w32_gstr(ARG(0),1,raw,sizeof raw);w32_fs_normalize(raw,path);fs_node_t *n=fs_lookup(path);
    if(!n){last_error=2;return 0;}last_error=5;return 0; /* CRT owns mutable file nodes; never desynchronise them. */
}
