/* CC0: module self-open + sparse streamed range read + Win32 seek/EOF/error contracts. */
#include <windows.h>
static unsigned char bytes[48];
void file_checks(void) {
    unsigned checks=0;DWORD got=0;
    WCHAR path[256];GetModuleFileNameW(0,path,256);
    HANDLE h=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
    if(h!=INVALID_HANDLE_VALUE) {
        if(ReadFile(h,bytes,2,&got,0)&&got==2&&bytes[0]=='M'&&bytes[1]=='Z')checks|=1;
        LARGE_INTEGER size,where;GetFileSizeEx(h,&size);where.QuadPart=size.QuadPart-16;
        if(SetFilePointerEx(h,where,0,FILE_BEGIN)&&ReadFile(h,bytes,16,&got,0)&&got==16)checks|=2;
        if(ReadFile(h,bytes,16,&got,0)&&got==0)checks|=4;
        where.QuadPart=-1;
        if(!SetFilePointerEx(h,where,0,FILE_BEGIN)&&GetLastError()==ERROR_INVALID_PARAMETER)checks|=8;
        CloseHandle(h);
    }
    h=CreateFileA("range-fixture.dat",GENERIC_READ,0,0,OPEN_EXISTING,0,0);
    if(h!=INVALID_HANDLE_VALUE) {
        LARGE_INTEGER p;p.QuadPart=4194304-8;
        if(SetFilePointerEx(h,p,0,FILE_BEGIN)&&ReadFile(h,bytes,32,&got,0)&&got==32) {
            int ok=1;for(int i=0;i<32;i++)if(bytes[i]!=(unsigned char)(((4194304-8+i)*17+3)^((4194304-8+i)>>16)))ok=0;
            if(ok)checks|=16;
        }
        CloseHandle(h);
    }
    h=CreateFileA("missing-fixture.dat",GENERIC_READ,0,0,OPEN_EXISTING,0,0);
    if(h==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_FILE_NOT_FOUND)checks|=32;
    char line[80];wsprintfA(line,"files checks=%08x",checks);OutputDebugStringA(line);
}
