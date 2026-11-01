/* Original CC0 fixture: real guest IMMNotificationClient implementations, never host callbacks. */
typedef struct {
    IMMNotificationClient iface;
    ULONG refs, adds, releases, changes;
} notification_client;
static notification_client *reentrant_client;
static IMMDeviceEnumerator *reentrant_enumerator, *unregister_reentry;
static HRESULT unregister_reentry_result;
static void notification_expect(int ok, const char *message) {
    if (!ok) { OutputDebugStringA(message); ExitProcess(25); }
}
static HRESULT WINAPI notify_query(IMMNotificationClient *self, REFIID iid, void **out) {
    if (!out) return E_POINTER;
    *out = 0;
    if (!IsEqualIID(iid, &IID_IUnknown) && !IsEqualIID(iid, &IID_IMMNotificationClient)) return E_NOINTERFACE;
    *out = self; IMMNotificationClient_AddRef(self); return S_OK;
}
static ULONG WINAPI notify_add(IMMNotificationClient *self) {
    notification_client *n = (notification_client *)self;
    n->adds++; return ++n->refs;
}
static ULONG WINAPI notify_release(IMMNotificationClient *self) {
    notification_client *n = (notification_client *)self;
    n->releases++; --n->refs;
    if (unregister_reentry) {
        IMMDeviceEnumerator *owner = unregister_reentry; unregister_reentry = 0;
        unregister_reentry_result = IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(owner, self);
    }
    if (reentrant_client == n) {
        reentrant_client = 0;
        check(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
            &IID_IMMDeviceEnumerator, (void **)&reentrant_enumerator));
        check(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(reentrant_enumerator, self));
    }
    return n->refs;
}
static HRESULT WINAPI notify_state(IMMNotificationClient *self, LPCWSTR id, DWORD state) {
    (void)id; (void)state; ((notification_client *)self)->changes++; return S_OK;
}
static HRESULT WINAPI notify_added(IMMNotificationClient *self, LPCWSTR id) {
    (void)id; ((notification_client *)self)->changes++; return S_OK;
}
static HRESULT WINAPI notify_default(IMMNotificationClient *self, EDataFlow flow, ERole role, LPCWSTR id) {
    (void)flow; (void)role; (void)id; ((notification_client *)self)->changes++; return S_OK;
}
static HRESULT WINAPI notify_property(IMMNotificationClient *self, LPCWSTR id, const PROPERTYKEY key) {
    (void)id; (void)key; ((notification_client *)self)->changes++; return S_OK;
}
static IMMNotificationClientVtbl notification_vtable = {notify_query, notify_add, notify_release,
    notify_state, notify_added, notify_added, notify_default, notify_property};
static notification_client endpoint_listener = {{&notification_vtable}, 1, 0, 0, 0};
static void test_notifications(IMMDeviceEnumerator *e) {
    IMMDeviceEnumerator *other;
    notification_client *n = &endpoint_listener;
#define NC(x) notification_expect((x), "x64-audio notification FAIL: " #x)
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, 0) == E_POINTER);
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, 0) == E_POINTER);
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, (IMMNotificationClient *)(ULONG_PTR)1) == E_POINTER);
#ifdef _WIN64
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, (IMMNotificationClient *)(ULONG_PTR)0x100000000ull) == E_POINTER);
#endif
    IMMNotificationClient bad = {0};
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &bad) == E_POINTER);
    bad.lpVtbl = (IMMNotificationClientVtbl *)(ULONG_PTR)1;
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &bad) == E_POINTER);
    notification_client owned = {{&notification_vtable}, 1, 0, 0, 0};
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &owned.iface) == S_OK);
    NC(IMMNotificationClient_Release(&owned.iface) == 1); /* caller drops its original reference */
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, &owned.iface) == S_OK && owned.refs == 0);
    NC(owned.adds == 1 && owned.releases == 2 && owned.changes == 0);
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, &n->iface) == HRESULT_FROM_WIN32(ERROR_NOT_FOUND));
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &n->iface) == S_OK);
    NC(n->refs == 2 && n->adds == 1 && n->changes == 0);
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &n->iface) == S_OK);
    NC(n->refs == 2 && n->adds == 1);
    check(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, (void **)&other));
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(other, &n->iface) == HRESULT_FROM_WIN32(ERROR_NOT_FOUND));
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(other, &n->iface) == S_OK && n->refs == 3);
    NC(IMMDeviceEnumerator_Release(other) == 0 && n->refs == 2 && n->releases == 1);
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, &n->iface) == S_OK);
    NC(n->refs == 1 && n->releases == 2);
    NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, &n->iface) == HRESULT_FROM_WIN32(ERROR_NOT_FOUND));
    /* Allocation failure must not acquire a reference; freed registrations are reusable. */
    notification_client pool[65];
    for (unsigned i = 0; i < 65; i++) {
        pool[i] = (notification_client){{&notification_vtable}, 1, 0, 0, 0};
        NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &pool[i].iface) == (i < 64 ? S_OK : E_OUTOFMEMORY));
        NC(pool[i].refs == (i < 64 ? 2u : 1u));
    }
    for (unsigned i = 0; i < 64; i++) {
        NC(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(e, &pool[i].iface) == S_OK);
        NC(pool[i].refs == 1 && pool[i].releases == 1 && pool[i].changes == 0);
    }
    for (unsigned i = 0; i < 80; i++) {
        check(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
            &IID_IMMDeviceEnumerator, (void **)&other));
        NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(other, &n->iface) == S_OK && n->refs == 2);
        NC(IMMDeviceEnumerator_Release(other) == 0 && n->refs == 1);
    }
    /* A guest Release reenters COM during destruction and reuses the retiring object slot. */
    check(CoCreateInstance(&CLSID_MMDeviceEnumerator, 0, CLSCTX_INPROC_SERVER,
        &IID_IMMDeviceEnumerator, (void **)&other));
    check(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(other, &n->iface));
    reentrant_client = n;
    NC(IMMDeviceEnumerator_Release(other) == 0 && reentrant_client == 0 && n->refs == 2);
    NC(reentrant_enumerator != 0);
    IUnknown *survivor = 0;
    NC(IMMDeviceEnumerator_QueryInterface(reentrant_enumerator, &IID_IUnknown, (void **)&survivor) == S_OK);
    NC((void *)survivor == (void *)reentrant_enumerator);
    NC(IUnknown_Release(survivor) == 1); /* proves new COM metadata survived old destruction */
    unregister_reentry = reentrant_enumerator;
    check(IMMDeviceEnumerator_UnregisterEndpointNotificationCallback(reentrant_enumerator, &n->iface));
    NC(unregister_reentry == 0 && unregister_reentry_result == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) && n->refs == 1);
    NC(IMMDeviceEnumerator_Release(reentrant_enumerator) == 0);
    /* Keep this live while an audio thread renders: registration itself must not synthesize changes. */
    NC(IMMDeviceEnumerator_RegisterEndpointNotificationCallback(e, &n->iface) == S_OK && n->refs == 2);
    OutputDebugStringA("x64-audio notification lifetime/errors PASS");
#undef NC
}
