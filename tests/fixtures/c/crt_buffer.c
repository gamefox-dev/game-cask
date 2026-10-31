/* Original CC0 fixture: same binary FILE bytes/positions on native libc and Windows guest. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <wchar.h>
#include <errno.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <windows.h>
#endif
#ifndef UNBUFFERED
#define UNBUFFERED 0
#endif
static unsigned failures;
#define CHECK(x) do { if(!(x)){printf("FAIL line=%d %s\n",__LINE__,#x);failures++;} } while(0)
static unsigned char byte_at(unsigned i){return (unsigned char)(i*29u+(i>>8));}
int main(void){
 FILE *f=fopen("large.bin","rb");CHECK(f!=0);if(!f)return 1;
#ifdef ERROR_ONLY
 unsigned char b[2];CHECK(fread(b,1,2,f)==0);CHECK(ferror(f)&&!feof(f));
 clearerr(f);CHECK(!ferror(f)&&!feof(f));CHECK(fgetc(f)==EOF);CHECK(ferror(f)&&!feof(f));
 rewind(f);CHECK(!ferror(f)&&!feof(f));CHECK(fclose(f)==0);
 printf("buffer failures=%u\n",failures);return failures?1:0;
#else
#if UNBUFFERED || defined(SMALL_ONLY)
#if UNBUFFERED
 CHECK(setvbuf(f,0,_IONBF,0)==0);
#endif
 unsigned sum=0;for(unsigned i=0;i<4096;i++){int c=fgetc(f);CHECK(c==byte_at(i));sum=sum*33u+(unsigned)c;}
 CHECK(ftell(f)==4096);printf("small=%u pos=%ld\n",sum,ftell(f));
#else
 unsigned sum=0;
 for(unsigned i=0;i<262181;i++){
  int c=fgetc(f);CHECK(c==byte_at(i));sum=sum*33u+(unsigned)c;
  if(i==4095)printf("small=%u pos=%ld\n",sum,ftell(f));
  if(i%8191==0){
   long p=ftell(f);CHECK(ungetc(c,f)==c);CHECK(ftell(f)==p-1);CHECK(fgetc(f)==c);CHECK(ftell(f)==p);
  }
 }
#ifdef _WIN32
 OutputDebugStringA("large read complete");
#endif
 CHECK(!feof(f));CHECK(fgetc(f)==EOF);CHECK(feof(f));CHECK(!ferror(f));
 CHECK(ungetc('X',f)=='X');CHECK(!feof(f));CHECK(ftell(f)==262180);CHECK(fgetc(f)=='X');
 CHECK(ftell(f)==262181);CHECK(fgetc(f)==EOF);clearerr(f);CHECK(!feof(f)&&!ferror(f));
 CHECK(fseek(f,65530,SEEK_SET)==0);unsigned char block[37];CHECK(fread(block,1,37,f)==37);
 for(unsigned i=0;i<37;i++)CHECK(block[i]==byte_at(65530+i));
 CHECK(ftell(f)==65567);CHECK(fseek(f,-17,SEEK_CUR)==0);CHECK(ftell(f)==65550);
 CHECK(fgetc(f)==byte_at(65550));
 fpos_t pos;CHECK(fgetpos(f,&pos)==0);CHECK(fseek(f,0,SEEK_END)==0);CHECK(ftell(f)==262181);
 CHECK(fsetpos(f,&pos)==0);CHECK(ftell(f)==65551);CHECK(fgetc(f)==byte_at(65551));
 rewind(f);CHECK(ftell(f)==0&&!feof(f)&&!ferror(f));CHECK(fgetc(f)==byte_at(0));
 printf("large=%u pos=%ld\n",sum,ftell(f));
#endif
 CHECK(fclose(f)==0);
#if !UNBUFFERED && !defined(SMALL_ONLY)
 /* Small caller-owned input buffer, partial elements, direction changes and flush. */
 f=tmpfile();CHECK(f!=0);char owned[512];CHECK(setvbuf(f,owned,_IOFBF,32)==0);
 CHECK(fwrite("abcdef",1,6,f)==6);CHECK(ftell(f)==6);CHECK(fflush(f)==0);rewind(f);
 CHECK(fread(block,4,2,f)==1);CHECK(!memcmp(block,"abcdef",6));CHECK(feof(f));
 CHECK(owned[0]=='a'&&owned[5]=='f');
 clearerr(f);rewind(f);CHECK(fgetc(f)=='a');CHECK(fseek(f,0,SEEK_CUR)==0);
 CHECK(fwrite("Z",1,1,f)==1);CHECK(fflush(f)==0);rewind(f);CHECK(fread(block,1,6,f)==6);CHECK(!memcmp(block,"aZcdef",6));
 CHECK(fseek(f,-1,SEEK_SET)!=0);CHECK(!ferror(f));rewind(f);
 CHECK(fclose(f)==0);
 f=fopen("text.txt","r");CHECK(f!=0);CHECK(fgetc(f)=='A');CHECK(fgetc(f)=='\n');
#ifdef _WIN32
 CHECK(ftell(f)==3);
#else
 CHECK(ftell(f)==2);
#endif
 CHECK(ungetc('\n',f)=='\n');CHECK(fgetc(f)=='\n');CHECK(fgetc(f)=='B');
#ifdef _WIN32
 CHECK(fgetc(f)==EOF);CHECK(feof(f));clearerr(f);CHECK(fgetc(f)=='C');
#endif
 CHECK(fclose(f)==0);
 f=fopen("wide.bin","rb");CHECK(f!=0);
#ifdef _WIN32
 CHECK(fgetwc(f)==0x1234);CHECK(ftell(f)==2);CHECK(ungetwc(0x4321,f)==0x4321);CHECK(ftell(f)==0);
 CHECK(fgetwc(f)==0x4321);CHECK(fgetwc(f)==L'A');CHECK(fgetwc(f)==WEOF);rewind(f);
 CHECK(fgetwc(f)==0x1234);
#endif
 CHECK(fclose(f)==0);
#ifdef _WIN32
 f=fopen("large.bin","rb");CHECK(f!=0);CHECK(setvbuf(f,0,_IOFBF,32)==0);
 CHECK(fgetc(f)==byte_at(0));int fd=_fileno(f);CHECK(_lseek(fd,0,SEEK_CUR)==32);
 CHECK(_read(fd,block,3)==3);CHECK(block[0]==byte_at(32));CHECK(ftell(f)==35);
 CHECK(fseek(f,1,SEEK_SET)==0);CHECK(fgetc(f)==byte_at(1));CHECK(fflush(f)==0);
 CHECK(_lseek(fd,0,SEEK_CUR)==2);CHECK(_read(fd,block,1)==1&&block[0]==byte_at(2));
 FILE *alias=_fdopen(fd,"rb");CHECK(alias!=0);CHECK(fgetc(alias)==byte_at(3));
 CHECK(ftell(f)==4);CHECK(fseek(alias,100,SEEK_SET)==0);CHECK(fgetc(f)==byte_at(100));
 CHECK(fclose(alias)==0);CHECK(_read(fd,block,1)==-1);
 f=fopen("large.bin","rb");CHECK(f!=0);CHECK(_fseeki64(f,0x100000001ll,SEEK_SET)==0);
 CHECK(_ftelli64(f)==0x100000001ll);CHECK(ftell(f)==-1);CHECK(fgetc(f)==EOF&&feof(f));rewind(f);CHECK(_ftelli64(f)==0);CHECK(fclose(f)==0);
 f=tmpfile();CHECK(f!=0);setbuf(f,owned);CHECK(fputc('Q',f)=='Q');CHECK(ftell(f)==1);
 CHECK(_filelengthi64(_fileno(f))==0);CHECK(fflush(f)==0);CHECK(_filelengthi64(_fileno(f))==1);
 CHECK(setvbuf(f,0,99,32)!=0);CHECK(setvbuf(f,0,_IOFBF,1)!=0);
 CHECK(setvbuf(f,0,_IOFBF,65538)!=0&&errno==ENOMEM);
 CHECK(_setmode(_fileno(f),123)==-1&&errno==EINVAL);
 CHECK(fopen("text.txt","r,ccs=UTF-8")==0&&errno==EINVAL);
 setbuf(f,0);CHECK(fputc('R',f)=='R');CHECK(_filelengthi64(_fileno(f))==2);
 rewind(f);CHECK(fputwc(0x2345,f)==0x2345);CHECK(fflush(f)==0);rewind(f);CHECK(fgetwc(f)==0x2345);
 CHECK(fclose(f)==0);
 f=tmpfile();CHECK(f!=0);CHECK(fputws(L"wide \x1234\n",f)>=0);CHECK(ftell(f)==14);rewind(f);
 wchar_t wline[16];CHECK(fgetws(wline,16,f)==wline&&!wcscmp(wline,L"wide \x1234\n"));CHECK(fclose(f)==0);
 f=fopen("write.txt","w+t");CHECK(f!=0);CHECK(fputs("X\nY",f)>=0);CHECK(ftell(f)==4);
 CHECK(fflush(f)==0);CHECK(_setmode(_fileno(f),_O_BINARY)==_O_TEXT);rewind(f);
 CHECK(fread(block,1,4,f)==4&&!memcmp(block,"X\r\nY",4));
 CHECK(_setmode(_fileno(f),_O_TEXT)==_O_BINARY);rewind(f);CHECK(fgetwc(f)==L'X');CHECK(fgetwc(f)==L'\n');
 CHECK(fputc('Z',f)=='Z');CHECK(fseek(f,0,SEEK_SET)==0);CHECK(fgetc(f)=='X');CHECK(fclose(f)==0);
 f=fopen("text.txt","rb");CHECK(f!=0);CHECK(fputc('x',f)==EOF);CHECK(ferror(f));
 CHECK(fread(block,1,sizeof block,f)==6);CHECK(feof(f)&&ferror(f));
 clearerr(f);CHECK(!feof(f)&&!ferror(f));rewind(f);CHECK(fgetc(f)=='A');CHECK(fclose(f)==0);
 OutputDebugStringA("descriptor accounting start");
 f=fopen("text.txt","rt");CHECK(f!=0);fd=_fileno(f);CHECK(_read(fd,block,3)==2&&!memcmp(block,"A\n",2));
 OutputDebugStringA("descriptor text quota done");
 CHECK(_lseek(fd,0,SEEK_CUR)==3);CHECK(_read(fd,block,1)==1&&block[0]=='B');
 CHECK(_read(fd,block,2)==0);CHECK(_read(fd,block,1)==0);CHECK(_lseek(fd,0,SEEK_SET)==0);CHECK(_read(fd,block,1)==1&&block[0]=='A');CHECK(fclose(f)==0);
 OutputDebugStringA("descriptor control-z done");
 f=fopen("wide.bin","rb");CHECK(f!=0);CHECK(_read(_fileno(f),block,2)==2&&block[0]==0x34&&block[1]==0x12);CHECK(fclose(f)==0);
 OutputDebugStringA("descriptor binary done");
 f=fopen("cr-boundary.txt","rt");CHECK(f!=0);CHECK(fseek(f,65535,SEEK_SET)==0);CHECK(fgetc(f)=='\r');CHECK(ftell(f)==65536);CHECK(!ferror(f));CHECK(fclose(f)==0);
 f=fopen("text.txt","rt");CHECK(f!=0);char ca=0,cb=0;
 CHECK(fscanf(f,"%c%c",&ca,&cb)==2&&ca=='A'&&cb=='\n');CHECK(ftell(f)==3);CHECK(fgetc(f)=='B');CHECK(fclose(f)==0);
 f=fopen("scan-boundary.txt","rt");CHECK(f!=0);CHECK(fseek(f,65534,SEEK_SET)==0);
 CHECK(fscanf(f,"%c%c",&ca,&cb)==2&&ca=='A'&&cb=='\n');CHECK(ftell(f)==65537);CHECK(fgetc(f)=='B');CHECK(fclose(f)==0);
 f=fopen("cr-boundary.txt","rt");CHECK(f!=0);CHECK(_lseek(_fileno(f),65535,SEEK_SET)==65535);
 OutputDebugStringA("descriptor peek start");CHECK(_read(_fileno(f),block,1)==1&&block[0]=='\r');OutputDebugStringA("descriptor peek done");CHECK(fclose(f)==0);
 CHECK(setvbuf(stdout,0,_IOFBF,16)==0);fputs("buffered flush",stdout);CHECK(fflush(stdout)==0);OutputDebugStringA("sink checkpoint");
 fputs("buffered all",stdout);CHECK(fflush(0)==0);OutputDebugStringA("all checkpoint");setbuf(stdout,0);
#endif
#endif
 printf("buffer failures=%u\n",failures);return failures?1:0;
#endif
}
