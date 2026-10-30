/* Original CC0-1.0 engine-like integration fixture. Ordinary -O2/CRT Win64, no overrides/BGT imports. */
#define AUDIO_LIBRARY
#define AUDIO_LONG_STREAM
#define check audio_check
#include "../x64-audio/audio.c"
#undef check
#include <xinput.h>
#include <stdio.h>
static HANDLE audio_thread, worker_thread, work_ready, work_done;
static volatile LONG work_frame;
static unsigned checksum, file_reads, pad_frames, button_frames;
static DWORD WINAPI worker_main(void *unused) {
    (void)unused;
    for (;;) {
        if (WaitForSingleObject(work_ready, INFINITE) != WAIT_OBJECT_0) return 1;
        unsigned frame = work_frame;
        if (!frame) return 0x600u;
        if (frame == 1 || frame == 300) {
            char data[16]; DWORD got;
            HANDLE file = CreateFileA("scene.txt", GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, 0, 0);
            if (file == INVALID_HANDLE_VALUE || !ReadFile(file, data, sizeof data, &got, 0) || got != 16)
                return 2;
            CloseHandle(file);
            for (unsigned i = 0; i < got; i++) checksum = checksum * 33u + (unsigned char)data[i];
            file_reads++;
        }
        checksum = checksum * 1664525u + frame + 1013904223u;
        SetEvent(work_done);
    }
}
static void smoke_start(void) {
    work_ready = CreateEventA(0, FALSE, FALSE, 0); work_done = CreateEventA(0, FALSE, FALSE, 0);
    worker_thread = CreateThread(0, 0, worker_main, 0, 0, 0);
    audio_thread = CreateThread(0, 0, audio_main, 0, 0, 0);
    if (!work_ready || !work_done || !worker_thread || !audio_thread) ExitProcess(30);
}
static void smoke_frame(unsigned frame);
#define ENGINE_SMOKE
#include "../x64-gl/gl.c"
static void smoke_frame(unsigned frame) {
    work_frame = frame; SetEvent(work_ready);
    if (WaitForSingleObject(work_done, 1000) != WAIT_OBJECT_0) ExitProcess(31);
    XINPUT_STATE input = {0};
    if (XInputGetState(0, &input) == ERROR_SUCCESS) {
        pad_frames++; if (input.Gamepad.wButtons & XINPUT_GAMEPAD_A) button_frames++;
    }
    /* The background reacts to genuine XInput state, independent of keyboard/merged input. */
    glClearColor(input.Gamepad.wButtons & XINPUT_GAMEPAD_A ? 0.5f : 0.05f, 0.1f, 0.15f, 1);
    if (frame == 600) {
        work_frame = 0; SetEvent(work_ready);
        DWORD worker_code = 0, audio_code = 0;
        if (WaitForSingleObject(worker_thread, 1000) != WAIT_OBJECT_0 ||
            WaitForSingleObject(audio_thread, 1000) != WAIT_OBJECT_0 ||
            !GetExitCodeThread(worker_thread, &worker_code) || worker_code != 0x600u ||
            !GetExitCodeThread(audio_thread, &audio_code) || audio_code != 0xa0d10u || file_reads != 2)
            ExitProcess(32);
        CloseHandle(worker_thread); CloseHandle(audio_thread); CloseHandle(work_ready); CloseHandle(work_done);
        char text[192];
        snprintf(text, sizeof text, "x64-smoke PASS frames=600 worker=%08x files=%u pad=%u buttons=%u audio=joined",
            checksum, file_reads, pad_frames, button_frames);
        OutputDebugStringA(text);
        for (;;) Sleep(16);
    }
}
