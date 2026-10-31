/* LANE-K1: Winsock isolated/offline transport. Socket ownership, addressing, version negotiation
 * and error precedence are real; no packets, host DNS, proxy, or fabricated remote connections.
 * SPDX-License-Identifier: MIT */
#include "w32_ws2_32.h"
#include "w32_sysdll.h"
#include "w32_thread.h"
static uint32_t depth, sequence;
static struct socket_state { uint32_t h, family, type, nonblock, bound, listening, reuse, keepalive, broadcast, nodelay; uint8_t addr[28]; } sockets[64];
static uint32_t error(uint32_t e) { *w32_thread_error() = e; return 0xffffffffu; }
static struct socket_state *lookup(uint64_t h) {
    for (uint32_t i=0;i<64;i++) if (sockets[i].h && sockets[i].h==h) return &sockets[i];
    return 0;
}
static struct socket_state *current(void) {
    if (!depth) { error(10093); return 0; }
    struct socket_state *s=lookup(ARG64(0));
    if (!s) error(10038);
    return s;
}
static uint32_t startup(void) {
    uint32_t v=ARG(0)&65535, major=v&255, minor=v>>8, p=ARG(1);
    if (!w32_sys_span(ARG64(1),W32_64?408:400)) return 10014;
    if (major<1) return 10092;
    uint32_t n=W32_64?408:400;
    for(uint32_t i=0;i<n;i++) x86_wr8(p+i,0);
    uint32_t selected=major==1 ? (minor?0x101:1) : (major==2 && minor==0 ? 2 : 0x202);
    x86_wr16(p,selected); x86_wr16(p+2,0x202);
    w32_pstr(p+(W32_64?16:4),257,0,"BGT isolated Winsock");
    w32_pstr(p+(W32_64?273:261),129,0,"Offline");
    depth++; return 0;
}
static uint32_t cleanup(void) {
    if (!depth) return error(10093);
    if (!--depth) __builtin_memset(sockets,0,sizeof sockets);
    return 0;
}
static uint32_t last_error(void) { return *w32_thread_error(); }
static uint32_t create_socket(void) {
    if (!depth) return error(10093);
    if (ARG(0)!=2 && ARG(0)!=23) return error(10047);
    if (ARG(1)!=1 && ARG(1)!=2) return error(10044);
    if (ARG(2) && ARG(2)!=(ARG(1)==1?6u:17u)) return error(10043);
    for(uint32_t i=0;i<64;i++) if(!sockets[i].h) {
        sockets[i]=(struct socket_state){.h=0x36000000u+ ++sequence,.family=ARG(0),.type=ARG(1)};
        return sockets[i].h;
    }
    return error(10024);
}
static uint32_t close_socket(void) { struct socket_state *s=current(); if(!s)return ~0u;s->h=0;return 0; }
static int address(struct socket_state *s,uint64_t full,uint32_t n) {
    uint32_t p=(uint32_t)full;
    if (n<(s->family==2?16u:28u) || !w32_sys_span(full,s->family==2?16:28)) { error(10014); return 0; }
    if(x86_rd16(p)!=s->family) { error(10047); return 0; }
    return 1;
}
static uint32_t bind_socket(void) {
    struct socket_state *s=current(); if(!s)return ~0u;
    if(!address(s,ARG64(1),ARG(2)))return ~0u;
    if(s->bound)return error(10022);
    uint32_t n=s->family==2?16:28;
    /* Only wildcard local binding exists without any adapter. */
    for(uint32_t i=s->family==2?4:8;i<(s->family==2?8u:24u);i++)
        if(x86_rd8(ARG(1)+i))return error(10049);
    for(uint32_t j=0;j<64;j++) if(sockets[j].h && sockets[j].bound &&
        sockets[j].family==s->family && sockets[j].type==s->type && !s->reuse && x86_rd16(ARG(1)+2) &&
        sockets[j].addr[2]==x86_rd8(ARG(1)+2) && sockets[j].addr[3]==x86_rd8(ARG(1)+3)) return error(10048);
    for(uint32_t i=0;i<n;i++)s->addr[i]=x86_rd8(ARG(1)+i);
    if(!s->addr[2]&&!s->addr[3]) {
        uint32_t port=49152+(s->h&0x3fff),attempt;
        for(attempt=0;attempt<16384;attempt++,port=49152+((port+1)&0x3fff)) {
            int busy=0;
            for(uint32_t j=0;j<64;j++)if(sockets[j].h&&sockets[j].bound&&sockets[j].family==s->family&&sockets[j].type==s->type&&
                sockets[j].addr[2]==(port>>8)&&sockets[j].addr[3]==(port&255)){busy=1;break;}
            if(!busy)break;
        }
        if(attempt==16384)return error(10048);
        s->addr[2]=port>>8;s->addr[3]=port;
    }
    s->bound=1;return 0;
}
static uint32_t connect_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if(!address(s,ARG64(1),ARG(2)))return ~0u;
    return error(10051); /* WSAENETUNREACH: no route */
}
static uint32_t listen_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if(s->type!=1)return error(10045);
    if(!s->bound)return error(10022);
    s->listening=1;return 0;
}
static uint32_t accept_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if(!s->listening)return error(10022);
    /* No inbound transport in this profile. Blocking accept cannot complete offline. */
    return error(s->nonblock?10035:10050);
}
static uint32_t sockname(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    uint32_t n=s->family==2?16:28;
    if(!w32_sys_span(ARG64(2),4)||!w32_sys_span(ARG64(1),n)||x86_rd32(ARG(2))<n)return error(10014);
    if(!s->bound)return error(10022);
    for(uint32_t i=0;i<n;i++)x86_wr8(ARG(1)+i,s->addr[i]);
    x86_wr32(ARG(2),n);return 0;
}
static uint32_t ioctl_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if(!w32_sys_span(ARG64(2),4))return error(10014);
    if(ARG(1)==0x8004667eu) {s->nonblock=!!x86_rd32(ARG(2));return 0;}
    if(ARG(1)==0x4004667fu) {x86_wr32(ARG(2),0);return 0;}
    return error(10022);
}
static uint32_t option(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if(ARG(4)<4||!w32_sys_span(ARG64(3),ARG(4)))return error(10014);
    /* Store options as local socket state; reuse controls wildcard port ownership. */
    uint32_t value=!!x86_rd32(ARG(3));
    if(ARG(1)==0xffff) {
        if(ARG(2)==4){s->reuse=value;return 0;}
        if(ARG(2)==8){s->keepalive=value;return 0;}
        if(ARG(2)==32&&s->type==2){s->broadcast=value;return 0;}
    }
    if(ARG(1)==6 && ARG(2)==1 && s->type==1){s->nodelay=value;return 0;}
    return error(10042);
}
static uint32_t send_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if((int32_t)ARG(2)<0 || (ARG(2)&&!w32_sys_span(ARG64(1),ARG(2))))return error(10014);
    return error(10057);
}
static uint32_t recv_socket(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    if((int32_t)ARG(2)<0 || (ARG(2)&&!w32_sys_span(ARG64(1),ARG(2))))return error(10014);
    if(s->type==1)return error(10057);
    if(!s->bound)return error(10022);
    return error(s->nonblock?10035:10050);
}
static uint32_t send_to(void) {
    struct socket_state *s=current();if(!s)return ~0u;
    /* A stream ignores to/tolen: sendto is equivalent to send (WSAENOTCONN here). */
    if(s->type==1)return send_socket();
    if(!address(s,ARG64(4),ARG(5)))return ~0u;
    if((int32_t)ARG(2)<0||(ARG(2)&&!w32_sys_span(ARG64(1),ARG(2))))return error(10014);
    return error(10051);
}
static uint32_t swap16(uint32_t x) { return ((x&255)<<8)|((x>>8)&255); }
static uint32_t swap32(uint32_t x) { return (swap16(x)<<16)|swap16(x>>16); }
static uint32_t htons_api(void) {return swap16(ARG(0));}
static uint32_t htonl_api(void) {return swap32(ARG(0));}
static uint32_t fdset(void) {
    uint32_t p=ARG(1);if(!w32_sys_span(ARG64(1),4))return 0;
    uint32_t n=x86_rd32(p);if(n>64||!w32_sys_span(ARG64(1),(W32_64?8:4)+n*w32_ptr_size()))return 0;
    for(uint32_t i=0;i<n;i++)if(w32_rdptr(p+(W32_64?8:4)+i*w32_ptr_size())==ARG64(0))return 1;
    return 0;
}
static uint32_t select_socket(void) {
    if(!depth)return error(10093);
    uint32_t total=0;
    for(uint32_t j=1;j<=3;j++)if(ARG64(j)) {
        if(!w32_sys_span(ARG64(j),4))return error(10014);
        uint32_t p=ARG(j), n=x86_rd32(p);if(n>64)return error(10022);
        if(!w32_sys_span(ARG64(j),(W32_64?8:4)+n*w32_ptr_size()))return error(10014);
        total+=n;
        for(uint32_t i=0;i<n;i++)if(!lookup(w32_rdptr(p+(W32_64?8:4)+i*w32_ptr_size())))return error(10038);
    }
    if(!total)return error(10022);
    if(!ARG64(4))return error(10050); /* indefinite blocking cannot progress without transport */
    if(!w32_sys_span(ARG64(4),8))return error(10014);
    int32_t sec=x86_rd32(ARG(4)), us=x86_rd32(ARG(4)+4);
    if(sec<0||us<0||us>=1000000)return error(10022);
    for(uint32_t j=1;j<=3;j++)if(ARG(j))x86_wr32(ARG(j),0);
    uint64_t ms=(uint64_t)sec*1000+(us+999)/1000;
    if(ms)w32_sleep_ms(ms>UINT32_MAX?UINT32_MAX:(uint32_t)ms);
    return 0;
}
/* Strict dotted IPv4; inet_addr additionally implements historical 1/2/3-part and octal/hex forms. */
static int ipv4(const char *s,uint8_t out[4],int legacy) {
    uint32_t parts[4],n=0;
    for(;;) {
        if(n==4||!*s)return 0;
        uint64_t v=0;uint32_t base=10,digits=0;
        if(legacy&&s[0]=='0') {base=8;if(s[1]=='x'||s[1]=='X'){base=16;s+=2;}}
        while(*s) {
            uint32_t d=*s>='0'&&*s<='9'?(uint32_t)(*s-'0'):*s>='a'&&*s<='f'?(uint32_t)(*s-'a'+10):*s>='A'&&*s<='F'?(uint32_t)(*s-'A'+10):99;
            if(d>=base)break;
            v=v*base+d;if(v>UINT32_MAX)return 0;s++;digits++;
        }
        if(!digits)return 0;
        parts[n++]=(uint32_t)v;
        if(*s!='.')break;
        s++;
    }
    if(legacy) {while(*s==' '||*s=='\t'||*s=='\r'||*s=='\n')s++;}
    if(*s||(!legacy&&n!=4))return 0;
    uint64_t v=parts[n-1];uint64_t limit=1ull<<(8*(5-n));if(v>=limit)return 0;
    for(uint32_t i=0;i+1<n;i++){if(parts[i]>255)return 0;v|=(uint64_t)parts[i]<<(8*(3-i));}
    for(uint32_t i=0;i<4;i++)out[i]=(uint8_t)(v>>(24-8*i));return 1;
}
static int ipv6(const char *s,uint8_t out[16]) {
    uint16_t words[8];uint32_t n=0;int gap=-1;
    if(*s==':'){if(s[1]!=':')return 0;gap=0;s+=2;}
    while(*s) {
        if(n==8)return 0;
        const char *start=s;uint32_t v=0,k=0;
        while((*s>='0'&&*s<='9')||(*s>='a'&&*s<='f')||(*s>='A'&&*s<='F')) {
            v=v*16+(*s<='9'?*s-'0':(*s|32)-'a'+10);s++;if(++k>4)return 0;
        }
        if(*s=='.') {uint8_t b[4];if(n>6||!ipv4(start,b,0))return 0;words[n++]=(b[0]<<8)|b[1];words[n++]=(b[2]<<8)|b[3];s+=__builtin_strlen(s);break;}
        if(!k)return 0;words[n++]=v;
        if(!*s)break;
        if(*s++!=':')return 0;
        if(*s==':'){if(gap>=0)return 0;gap=(int)n;s++;if(!*s)break;}
        else if(!*s)return 0;
    }
    if(gap<0&&n!=8)return 0;
    if(gap>=0){if(n>=8)return 0;uint32_t zeros=8-n;for(int i=(int)n-1;i>=gap;i--)words[i+zeros]=words[i];for(uint32_t i=0;i<zeros;i++)words[gap+i]=0;}
    for(uint32_t i=0;i<8;i++){out[2*i]=words[i]>>8;out[2*i+1]=words[i];}return 1;
}
static uint32_t inet_address(void) {
    char text[128];uint8_t b[4];if(!w32_sys_string(ARG64(0),0,sizeof text))return ~0u;
    w32_gstr(ARG(0),0,text,sizeof text);if(!ipv4(text,b,1))return ~0u;
    return b[0]|(b[1]<<8)|(b[2]<<16)|((uint32_t)b[3]<<24);
}
static uint32_t pton(void) {
    if(ARG(0)!=2&&ARG(0)!=23)return error(10047);
    if(!w32_sys_string(ARG64(1),0,128)||!w32_sys_span(ARG64(2),ARG(0)==2?4:16))return error(10014);
    char text[128];uint8_t b[16];w32_gstr(ARG(1),0,text,sizeof text);
    if(!(ARG(0)==2?ipv4(text,b,0):ipv6(text,b)))return 0;
    for(uint32_t i=0;i<(ARG(0)==2?4u:16u);i++)x86_wr8(ARG(2)+i,b[i]);return 1;
}
/* No DNS provider. Numeric and wildcard address info needs no network. Owned single allocation. */
static struct {uint32_t p;} results[64];
static uint32_t gai_error(uint32_t e) {*w32_thread_error()=e;return e;}
static uint32_t getaddr(void) {
    if(!depth)return gai_error(10093);
    if(!w32_sys_span(ARG64(3),w32_ptr_size()))return gai_error(10014);w32_wrptr(ARG(3),0);
    if((ARG64(0)&&!w32_sys_string(ARG64(0),0,256))||(ARG64(1)&&!w32_sys_string(ARG64(1),0,64))||
        (ARG64(2)&&!w32_sys_span(ARG64(2),W32_64?48:32)))return gai_error(10014);
    if(!ARG(0)&&!ARG(1))return gai_error(11001);
    uint32_t flags=0,family=0,type=0,protocol=0;
    if(ARG(2)){flags=x86_rd32(ARG(2));family=x86_rd32(ARG(2)+4);type=x86_rd32(ARG(2)+8);protocol=x86_rd32(ARG(2)+12);}
    if(flags&~0xfu)return gai_error(10022);
    if(family&&family!=2&&family!=23)return gai_error(10047);
    if(type&&type!=1&&type!=2)return gai_error(10044);
    if(protocol&&protocol!=6&&protocol!=17)return gai_error(10043);
    if((type==1&&protocol==17)||(type==2&&protocol==6))return gai_error(10043);
    if(!type)type=protocol==17?2:1;
    if(!protocol)protocol=type==1?6:17;
    uint32_t port=0;
    if(ARG(1)) {char service[64];w32_gstr(ARG(1),0,service,sizeof service);
        if(!service[0])return gai_error(10109);
        for(uint32_t i=0;service[i];i++){if(service[i]<'0'||service[i]>'9')return gai_error(10109);port=port*10+service[i]-'0';if(port>65535)return gai_error(10109);}}
    uint8_t b[16]={0};char node[256]="";
    if(ARG(0)) {
        w32_gstr(ARG(0),0,node,sizeof node);
        if((!family||family==2)&&ipv4(node,b,0))family=2;
        else if((!family||family==23)&&ipv6(node,b))family=23;
        else return gai_error(11001);
    } else {if(!family)family=2;if(!(flags&1)){if(family==2){b[0]=127;b[3]=1;}else b[15]=1;}}
    uint32_t slot;for(slot=0;slot<64;slot++)if(!results[slot].p)break;
    if(slot==64)return gai_error(8);
    uint32_t size=W32_64?48:32, alen=family==2?16:28;
    uint32_t p=w32_heap_alloc(size+alen+256,1);if(!p)return gai_error(8);results[slot].p=p;
    x86_wr32(p,flags);x86_wr32(p+4,family);x86_wr32(p+8,type);x86_wr32(p+12,protocol);
    w32_wrptr(p+16,alen);w32_wrptr(p+(W32_64?32:24),p+size);
    if((flags&2)&&ARG(0)){w32_wrptr(p+(W32_64?24:20),p+size+alen);w32_pstr(p+size+alen,256,0,node);}
    x86_wr16(p+size,family);x86_wr16(p+size+2,swap16(port));
    for(uint32_t i=0;i<(family==2?4u:16u);i++)x86_wr8(p+size+(family==2?4:8)+i,b[i]);
    w32_wrptr(ARG(3),p);return 0;
}
static uint32_t freeaddr(void) {
    for(uint32_t i=0;i<64;i++)if(results[i].p&&results[i].p==ARG64(0)){w32_heap_free(results[i].p);results[i].p=0;break;}return 0;
}
static uint32_t nameinfo(void) {
    if(!depth)return gai_error(10093);
    if(ARG(1)<2||!w32_sys_span(ARG64(0),ARG(1)))return gai_error(10014);
    if((ARG64(2)&&!w32_sys_span(ARG64(2),ARG(3)))||(ARG64(4)&&!w32_sys_span(ARG64(4),ARG(5))))return gai_error(10014);
    uint32_t family=x86_rd16(ARG(0)),flags=ARG(6);
    if(family!=2&&family!=23)return gai_error(10047);
    if(ARG(1)<(family==2?16u:28u))return gai_error(10014);
    if(flags&~0x1fu)return gai_error(10022);
    if((!ARG(2)||!ARG(3))&&(!ARG(4)||!ARG(5)))return gai_error(10022);
    if((flags&4)&&!(flags&2)&&ARG(2))return gai_error(11001);
    char host[80],service[8];uint32_t n=0,port=swap16(x86_rd16(ARG(0)+2));
    if(family==2){for(uint32_t i=0;i<4;i++){uint32_t v=x86_rd8(ARG(0)+4+i);if(i)host[n++]='.';if(v>=100)host[n++]='0'+v/100;if(v>=10)host[n++]='0'+v/10%10;host[n++]='0'+v%10;}}
    else {static const char hex[]="0123456789abcdef";for(uint32_t i=0;i<8;i++){if(i)host[n++]=':';uint32_t v=x86_rd8(ARG(0)+8+i*2)*256+x86_rd8(ARG(0)+9+i*2);int started=0;for(int shift=12;shift>=0;shift-=4){uint32_t d=(v>>shift)&15;if(d||started||!shift){host[n++]=hex[d];started=1;}}}}
    host[n]=0;uint32_t k=0;do{service[k++]='0'+port%10;port/=10;}while(port);for(uint32_t i=0;i<k/2;i++){char c=service[i];service[i]=service[k-1-i];service[k-1-i]=c;}service[k]=0;
    if((ARG(2)&&ARG(3)<=n)||(ARG(4)&&ARG(5)<=k))return gai_error(10014);
    if(ARG(2))w32_pstr(ARG(2),ARG(3),0,host);if(ARG(4))w32_pstr(ARG(4),ARG(5),0,service);return 0;
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_ws2_32[] = {
    API("WSAStartup",2,startup),API("WSACleanup",0,cleanup),API("WSAGetLastError",0,last_error),
    API("socket",3,create_socket),API("closesocket",1,close_socket),API("bind",3,bind_socket),
    API("connect",3,connect_socket),API("WSAConnect",7,connect_socket),API("listen",2,listen_socket),
    API("accept",3,accept_socket),API("getsockname",3,sockname),API("ioctlsocket",3,ioctl_socket),
    API("setsockopt",5,option),API("send",4,send_socket),API("recv",4,recv_socket),
    API("sendto",6,send_to),API("recvfrom",6,recv_socket),API("select",5,select_socket),
    API("__WSAFDIsSet",2,fdset),API("htons",1,htons_api),API("ntohs",1,htons_api),
    API("htonl",1,htonl_api),API("ntohl",1,htonl_api),API("inet_addr",1,inet_address),
    API("inet_pton",3,pton),API("getaddrinfo",4,getaddr),API("freeaddrinfo",1,freeaddr),API("getnameinfo",7,nameinfo),
};
const uint32_t w32_api_ws2_32_n=sizeof w32_api_ws2_32/sizeof w32_api_ws2_32[0];
const w32_api_t *w32_winsock_find(const char *name) {
    for(uint32_t i=0;i<w32_api_ws2_32_n;i++)if(w32_streqi(name,w32_api_ws2_32[i].name))return &w32_api_ws2_32[i];return 0;
}
