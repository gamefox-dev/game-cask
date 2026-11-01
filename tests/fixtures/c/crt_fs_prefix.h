/* Original CC0: extended DOS names and UNC-less aliases share VFS identity across APIs. */
static void prefix_path(char *a, wchar_t *w, const char *base, const char *leaf) {
    unsigned n = 0;
    while (*base) { a[n] = *base; w[n++] = (unsigned char)*base++; }
    while (*leaf) { a[n] = *leaf; w[n++] = (unsigned char)*leaf++; }
    a[n] = 0; w[n] = 0;
}
static void test_prefixes(void) {
    unsigned before = failures;
    const char *bases[] = {"C:\\GAME\\", "\\\\?\\C:\\GAME\\", "\\\\.\\C:\\GAME\\", "\\GAME\\", "", "C:", "\\\\?\\c:\\game\\"};
    char a[520], full[560]; wchar_t w[520], wfull[560];
    struct _stat64 normal, prefixed;
    CHECK(_stat64("nested/seed.txt", &normal) == 0);
    CHECK(CreateDirectoryW(L"\\\\?\\C:\\GAME\\prefix", 0));
    CHECK(!CreateDirectoryW(L"\\\\?\\C:\\GAME", 0) && GetLastError() == ERROR_ALREADY_EXISTS);
    CHECK(!CreateDirectoryW(L"\\\\.\\C:\\GAME", 0) && GetLastError() == ERROR_ALREADY_EXISTS);
    for (unsigned i = 0; i < sizeof bases / sizeof bases[0]; i++) {
        prefix_path(a, w, bases[i], "prefix");
        CHECK(k_dir(w) && is_dir(a));
        CHECK(!CreateDirectoryW(w, 0) && GetLastError() == ERROR_ALREADY_EXISTS);
        FAILS(_wmkdir(w), EEXIST);
        prefix_path(a, w, bases[i], "prefix\\missing\\child");
        CHECK(!CreateDirectoryW(w, 0) && GetLastError() == ERROR_PATH_NOT_FOUND);
        FAILS(_mkdir(a), ENOENT);
        prefix_path(a, w, bases[i], "prefix\\child");
        CHECK(_wmkdir(w) == 0 && k_dir(L"prefix\\child"));
        CHECK(_chdir(a) == 0);
        CHECK(_getcwd(full, sizeof full) == full && eq(full, "C:\\GAME\\prefix\\child"));
        CHECK(SetCurrentDirectoryW(L"\\\\?\\C:\\GAME"));
        CHECK(RemoveDirectoryW(w));
        prefix_path(a, w, bases[i], "nested\\seed.txt");
        CHECK(_wstat64(w, &prefixed) == 0 && prefixed.st_mode == normal.st_mode &&
            prefixed.st_size == normal.st_size && prefixed.st_ctime == normal.st_ctime);
        CHECK(GetFileAttributesW(w) == GetFileAttributesW(L"nested\\seed.txt"));
        WIN32_FILE_ATTRIBUTE_DATA attrs;
        CHECK(GetFileAttributesExW(w, GetFileExInfoStandard, &attrs) && attrs.nFileSizeLow == normal.st_size);
        WIN32_FIND_DATAW fd;
        HANDLE find = FindFirstFileW(w, &fd);
        CHECK(find != INVALID_HANDLE_VALUE && weq(fd.cFileName, L"seed.txt") && fd.nFileSizeLow == normal.st_size);
        CHECK(FindClose(find));
        HANDLE f = CreateFileW(w, GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, 0, 0);
        DWORD got = 0; char content[32] = {0};
        CHECK(f != INVALID_HANDLE_VALUE);
        CHECK(ReadFile(f, content, sizeof content - 1, &got, 0) && got == normal.st_size && eq(content, "original fixture\n"));
        CHECK(CloseHandle(f));
#ifdef _WIN64
        /* Descriptor-open APIs are a separate unimplemented CRT family. Exercise the existing
         * descriptor backend via a normally opened wide FILE, without a success stub/override. */
        FILE *descriptor_stream = _wfopen(w, L"rb");
        CHECK(descriptor_stream != 0);
        int desc = _fileno(descriptor_stream);
        CHECK(desc >= 0);
        CHECK(_read(desc, content, sizeof content) == normal.st_size);
        CHECK(_close(desc) == 0);
        FILE *fp = _wfopen(w, L"rb");
        CHECK(fp && fread(content, 1, sizeof content, fp) == normal.st_size);
        CHECK(fclose(fp) == 0);
#endif
        prefix_path(a, w, bases[i], "prefix\\*");
        list_t l, ref; list_crt(a, &l); list_k32(L"prefix\\*", &ref);
        CHECK(same_lists(&l, &ref) && has(&l, ".") && has(&l, ".."));
        list_k32(w, &l); CHECK(same_lists(&l, &ref));
        prefix_path(a, w, bases[i], "nested\\seed.txt");
        /* Fullpath preserves the caller's component case, including a lowercase root alias. */
        const char *expected = i == 6 ? "C:\\game\\nested\\seed.txt" : "C:\\GAME\\nested\\seed.txt";
        const wchar_t *wexpected = i == 6 ? L"C:\\game\\nested\\seed.txt" : L"C:\\GAME\\nested\\seed.txt";
        CHECK(_fullpath(full, a, sizeof full) == full && eq(full, expected));
        CHECK(_wfullpath(wfull, w, 560) == wfull && weq(wfull, wexpected));
        prefix_path(a, w, bases[i], "prefix\\bad?name");
        CHECK(!CreateDirectoryW(w, 0) && GetLastError() == ERROR_INVALID_NAME);
        CHECK(CreateFileW(w, GENERIC_READ, 0, 0, OPEN_EXISTING, 0, 0) == INVALID_HANDLE_VALUE && GetLastError() == ERROR_INVALID_NAME);
        prefix_path(a, w, bases[i], "prefix\\missing\\file");
        CHECK(CreateFileW(w, GENERIC_READ, 0, 0, OPEN_EXISTING, 0, 0) == INVALID_HANDLE_VALUE && GetLastError() == ERROR_PATH_NOT_FOUND);
    }
#ifdef _WIN64
    /* Named mutable bytes, rename and remove must keep one identity too; no persistence claim. */
    FILE *fp = _wfopen(L"\\\\?\\C:\\GAME\\prefix\\tone.dat", L"wb");
    CHECK(fp && fwrite("tone", 1, 4, fp) == 4 && fclose(fp) == 0);
    CHECK(_stat64("prefix/tone.dat", &prefixed) == 0 && prefixed.st_size == 4);
    CHECK(_wrename(L"\\\\.\\C:\\GAME\\prefix\\tone.dat", L"\\\\?\\C:\\GAME\\prefix\\renamed.dat") == 0);
    CHECK(absent("prefix/tone.dat") && _stat64("prefix/renamed.dat", &prefixed) == 0 && prefixed.st_size == 4);
    CHECK(DeleteFileW(L"\\\\?\\C:\\GAME\\prefix\\renamed.dat"));
    CHECK(absent("prefix/renamed.dat"));
#endif
    CHECK(MoveFileW(L"\\\\?\\C:\\GAME\\prefix", L"\\\\.\\C:\\GAME\\renamed-prefix"));
    CHECK(k_missing(L"prefix") && is_dir("renamed-prefix"));
    CHECK(_wrmdir(L"\\\\?\\C:\\GAME\\renamed-prefix") == 0);
    /* Unsupported namespaces must fail before wildcard/drive stripping, never alias the local root. */
    const char *unsupported[] = {"\\\\?\\UNC\\server\\share\\nested\\seed.txt", "\\\\server\\share\\nested\\seed.txt", "//server/share/nested/seed.txt",
        "\\\\.\\pipe\\name", "\\\\.\\PhysicalDrive0", "\\\\?\\GLOBALROOT\\Device", "\\\\?\\C:relative", "\\\\?\\nested\\seed.txt", "\\\\?\\"};
    for (unsigned i = 0; i < sizeof unsupported / sizeof unsupported[0]; i++) {
        prefix_path(a, w, unsupported[i], "");
        DWORD error = i < 3 ? ERROR_BAD_NETPATH : ERROR_INVALID_NAME;
        int crt_error = i < 3 ? ENOENT : EINVAL;
        CHECK(!CreateDirectoryW(w, 0) && GetLastError() == error);
        CHECK(GetFileAttributesW(w) == INVALID_FILE_ATTRIBUTES && GetLastError() == error);
        WIN32_FIND_DATAW fd;
        CHECK(FindFirstFileW(w, &fd) == INVALID_HANDLE_VALUE && GetLastError() == error);
        CHECK(CreateFileW(w, GENERIC_READ, 0, 0, OPEN_EXISTING, 0, 0) == INVALID_HANDLE_VALUE && GetLastError() == error);
        FAILS(_mkdir(a), crt_error);
        FAILS(_wstat64(w, &prefixed), ENOENT); /* existing UCRT stat lookup mapping */
        CHECK(GetFullPathNameW(w, 560, wfull, 0) == 0 && GetLastError() == error);
        NULLS(_fullpath(full, a, sizeof full), crt_error);
#ifdef _WIN64
        NULLS(_wfopen(w, L"rb"), crt_error);
#endif
    }
    OutputDebugStringA(failures == before ? "crtfs extended DOS prefixes PASS" : "crtfs extended DOS prefixes FAIL");
}
