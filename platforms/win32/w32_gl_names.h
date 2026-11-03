/* GL names are full GLuints; slots and wire handles are private. SPDX-License-Identifier: MIT */
typedef struct {
    void *base; uint32_t stride, peak, failures, failed_requests; const char *kind; uint8_t retired[N];
} GlObjects;
static GlObjects gl_objects[9]; static uint32_t gl_object_count, gl_retired, gl_exhaustion_events;
static void retire_name(GlObjects *o, uint32_t slot) { if (!o->retired[slot]) { o->retired[slot] = 1; gl_retired++; } }
static GlObjects *objects(void *base, uint32_t stride, const char *kind) {
    for (uint32_t i = 0; i < gl_object_count; i++) if (gl_objects[i].base == base) return &gl_objects[i];
    GlObjects *o = &gl_objects[gl_object_count++]; o->base = base; o->stride = stride; o->kind = kind; return o;
}
static uint32_t object_name(const GlObjects *o, uint32_t slot) {
    return slot && slot < N ? *(uint32_t *)((uint8_t *)o->base + o->stride * slot) : 0;
}
static uint32_t object_live(const GlObjects *o) {
    uint32_t live = 0; for (uint32_t i = 1; i < N; i++) live += object_name(o, i) != 0 && !o->retired[i]; return live;
}
static void obj_put(char *s, uint32_t *at, const char *v) { while (*v) s[(*at)++] = *v++; s[*at] = 0; }
static void obj_uint(char *s, uint32_t *at, uint32_t v) {
    char b[10]; uint32_t n = 0; do { b[n++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (n) s[(*at)++] = b[--n];
    s[*at] = 0;
}
static void init_objects(void);
static void object_exhaustion(const char *kind, const char *reason, uint32_t requests) {
    init_objects();
    uint32_t live = 0, failures = 0; gl_exhaustion_events++;
    for (uint32_t i = 0; i < gl_object_count; i++) if (eq(gl_objects[i].kind, kind)) {
        GlObjects *o = &gl_objects[i]; live = object_live(o); failures = ++o->failures; o->failed_requests += requests;
    }
    char msg[240]; uint32_t at = 0; obj_put(msg, &at, kind); obj_put(msg, &at, " reason="); obj_put(msg, &at, reason);
    obj_put(msg, &at, " live="); obj_uint(msg, &at, live); obj_put(msg, &at, " failures="); obj_uint(msg, &at, failures);
    obj_put(msg, &at, " failed_requests="); obj_uint(msg, &at, requests);
    w32_logf2("GL_OUT_OF_MEMORY object=", msg); fail(OOM);
}
static uint32_t find_name(GlObjects *o, uint32_t name) {
    if (!name) return 0;
    if (name < N && !o->retired[name] && object_name(o, name) == name) return name;
    for (uint32_t i = 1; i < N; i++) if (!o->retired[i] && object_name(o, i) == name) return i;
    return N;
}
#define OBJECTS(a) objects(a, sizeof *(a), #a)
#define SLOT(a, name) find_name(OBJECTS(a), name)
#define NAME(a, slot) object_name(OBJECTS(a), slot)
static uint32_t insert_name(GlObjects *o, uint32_t name) {
    for (uint32_t j = 1; j < N; j++) {
        uint32_t i = name < N && !object_name(o, name) ? name : j;
        if (object_name(o, i)) continue;
        void *p = (uint8_t *)o->base + o->stride * i; zero(p, o->stride); *(uint32_t *)p = name;
        uint32_t live = object_live(o); if (live > o->peak) o->peak = live; return i;
    }
    object_exhaustion(o->kind, "live object table", 1); return N;
}
static uint32_t new_name(GlObjects *o) {
    uint32_t name = 1;
    while (find_name(o, name) != N ||
        ((o->base == shaders || o->base == programs) &&
        (SLOT(shaders, name) != N || SLOT(programs, name) != N))) name++;
    uint32_t slot = insert_name(o, name); return slot == N ? 0 : slot;
}
#define alloc_name(a, stride) new_name(OBJECTS(a))
static uint32_t bind_name(GlObjects *o, uint32_t name) {
    uint32_t slot = find_name(o, name); return slot == N ? insert_name(o, name) : slot;
}
#define BIND(a, name) bind_name(OBJECTS(a), name)
/* Gen* is atomic on error: output memory and existing state are untouched. Only Create* returns0. */
static int gen_names(GlObjects *o, int32_t n) {
    if (n < 0) { fail(BAD_VALUE); return 0; }
    uint32_t free_slots = 0; for (uint32_t i = 1; i < N; i++) free_slots += object_name(o, i) == 0;
    if ((uint32_t)n > free_slots) {
        object_exhaustion(o->kind, "live object table", (uint32_t)n); return 0;
    }
    return 1;
}
#define GEN_CHECK(a) if (!gen_names(OBJECTS(a), (int32_t)ARG(0))) return 0
const char *w32_gl_objects_json(void) {
    init_objects();
    static char json[2048]; uint32_t at = 0; obj_put(json, &at, "{");
    for (uint32_t i = 0; i < gl_object_count; i++) {
        GlObjects *o = &gl_objects[i]; if (i) obj_put(json, &at, ",");
        obj_put(json, &at, "\""); obj_put(json, &at, o->kind); obj_put(json, &at, "\":{\"live\":"); obj_uint(json, &at, object_live(o));
        obj_put(json, &at, ",\"peak\":"); obj_uint(json, &at, o->peak);
        obj_put(json, &at, ",\"failures\":"); obj_uint(json, &at, o->failures);
        obj_put(json, &at, ",\"failed_requests\":"); obj_uint(json, &at, o->failed_requests); obj_put(json, &at, "}");
    }
    obj_put(json, &at, "}"); return json;
}
