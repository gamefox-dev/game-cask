/* GL names are full GLuints; slots and wire handles are private. SPDX-License-Identifier: MIT */
typedef struct {
    void *base, *allocation; uint32_t stride, capacity, peak, failures, failed_requests;
    const char *kind; uint8_t initial_retired[N], *retired;
    /* Flexible namespaces keep a hash of names -> stable slots (zero is empty).
     * Growing relocates storage, never slots/references. Everything is host-byte-budgeted. */
    uint32_t *index, live, occupied, next_name, next_slot, flexible;
} GlObjects;
static GlObjects gl_objects[9]; static uint32_t gl_object_count, gl_retired, gl_exhaustion_events;
/* Namespace identity is static even when its storage moves. Never compare kind strings
 * on a GL call. Keep registration order (and thus diagnostics) unchanged. */
static GlObjects *objects_textures, *objects_buffers, *objects_vaos, *objects_fbos, *objects_rbos;
static GlObjects *objects_samplers, *objects_gl_queries, *objects_shaders, *objects_programs;
static uint32_t initial_buffer_index[N * 2u], initial_vao_index[N * 2u];
static uint32_t object_name(const GlObjects *o, uint32_t slot) {
    return slot && slot < o->capacity ? *(uint32_t *)((uint8_t *)o->base + o->stride * slot) : 0;
}
static GlObjects *objects(GlObjects **cache, void *base, uint32_t stride, const char *kind) {
    if (*cache) return *cache;
    GlObjects *o = &gl_objects[gl_object_count++]; o->base = base; o->stride = stride; o->kind = kind;
    o->capacity = N; o->retired = o->initial_retired; o->next_name = o->next_slot = 1;
    o->flexible = base == buffers || base == vaos;
    if (o->flexible) o->index = base == buffers ? initial_buffer_index : initial_vao_index;
    *cache = o; return o;
}
static uint32_t object_live(const GlObjects *o) {
    if (o->flexible) return o->live;
    uint32_t live = 0; for (uint32_t i = 1; i < o->capacity; i++) live += object_name(o, i) != 0 && !o->retired[i]; return live;
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
static uint32_t name_hash(uint32_t name) { name ^= name >> 16; name *= 0x7feb352du; name ^= name >> 15; return name; }
static void index_name(GlObjects *o, uint32_t slot) {
    if (!o->index) return;
    uint32_t mask = o->capacity * 2u - 1u, at = name_hash(object_name(o, slot)) & mask;
    for (uint32_t n = 0; n <= mask; n++, at = (at + 1) & mask)
        if (!o->index[at]) { o->index[at] = slot; return; }
}
static void unindex_name(GlObjects *o, uint32_t slot) {
    uint32_t name = object_name(o, slot);
    if (!o->next_name || name < o->next_name) o->next_name = name;
    if (!o->index) return;
    uint32_t mask = o->capacity * 2u - 1u, at = name_hash(name) & mask;
    for (uint32_t n = 0; n <= mask && o->index[at]; n++, at = (at + 1) & mask)
        if (o->index[at] == slot) {
            /* Backward-shift deletion: churn must not fill the index with tombstones
             * and turn every absent-name lookup into a whole-table scan. */
            uint32_t hole = at;
            for (uint32_t next = (at + 1u) & mask; o->index[next]; next = (next + 1u) & mask) {
                uint32_t home = name_hash(object_name(o, o->index[next])) & mask;
                if (((hole - home) & mask) < ((next - home) & mask)) {
                    o->index[hole] = o->index[next]; hole = next;
                }
            }
            o->index[hole] = 0; return;
        }
}
static void retire_name(GlObjects *o, uint32_t slot) {
    if (!o->retired[slot]) {
        unindex_name(o, slot); o->retired[slot] = 1; gl_retired++;
        if (o->flexible) o->live--;
        if (o->base == buffers) queue_retired_buffer(slot); else image_collection_dirty = 1;
    }
}
static void erase_name(GlObjects *o, uint32_t slot) {
    if (o->flexible) { if (!o->retired[slot]) { unindex_name(o, slot); o->live--; } o->occupied--; }
    if (o->retired[slot]) { o->retired[slot] = 0; gl_retired--; }
    zero((uint8_t *)o->base + o->stride * slot, o->stride);
    if (slot < o->next_slot) o->next_slot = slot;
}
static uint32_t find_name(GlObjects *o, uint32_t name) {
    if (!name) return 0;
    if (name < o->capacity && !o->retired[name] && object_name(o, name) == name) return name;
    if (o->index) {
        uint32_t mask = o->capacity * 2u - 1u, at = name_hash(name) & mask;
        for (uint32_t n = 0; n <= mask && o->index[at]; n++, at = (at + 1) & mask) {
            GL_WORK(); uint32_t slot = o->index[at];
            if (object_name(o, slot) == name) return slot;
        }
    } else {
        for (uint32_t i = 1; i < o->capacity; i++) { GL_WORK(); if (!o->retired[i] && object_name(o, i) == name) return i; }
    }
    return o->capacity;
}
#define OBJECTS(a) objects(&objects_##a, a, sizeof *(a), #a)
#define SLOT(a, name) find_name(OBJECTS(a), name)
#define NAME(a, slot) object_name(OBJECTS(a), slot)
/* Atomic growth: allocate/copy the table, retirement bits and name index together, then publish.
 * No fixed count ceiling: overflow/address-space/host-arena exhaustion is truthful GL_OUT_OF_MEMORY. */
static int reserve_names(GlObjects *o, uint32_t extra) {
    if (!o->flexible || extra <= o->capacity - 1u - o->occupied) return 1;
    uint64_t need = (uint64_t)o->occupied + extra + 1u, cap = o->capacity;
    while (cap < need) cap *= 2u;
    /* Test builds can force a small real table limit to exercise atomic exhaustion. */
#ifdef W32_GL_TEST_NAME_LIMIT
    if (need > (uint64_t)W32_GL_TEST_NAME_LIMIT + 1u) return 0;
#endif
    uint64_t bytes = cap * (o->stride + 9u);
    if (cap > UINT32_MAX / 2u || bytes > UINT32_MAX) return 0;
    uint8_t *p = glp_alloc((uint32_t)bytes); if (!p) return 0;
    zero(p, (uint32_t)bytes); copy(p, o->base, o->stride * o->capacity);
    uint8_t *retired = p + cap * o->stride; copy(retired, o->retired, o->capacity);
    void *old = o->allocation; o->allocation = o->base = p; o->retired = retired;
    o->index = (uint32_t *)(void *)(retired + cap); o->capacity = (uint32_t)cap;
    if (eq(o->kind, "buffers")) { buffers = (Buffer *)(void *)p; buffer_slots = o->capacity; }
    else { vaos = (Vao *)(void *)p; vao_slots = o->capacity; }
    for (uint32_t i = 1; i < o->capacity; i++) if (object_name(o, i) && !o->retired[i]) index_name(o, i);
    glp_free(old, 0); return 1;
}
static uint32_t insert_name(GlObjects *o, uint32_t name) {
    if (!reserve_names(o, 1)) { object_exhaustion(o->kind, "object table host memory", 1); return o->capacity; }
    uint32_t slot = name < o->capacity && !object_name(o, name) ? name : 0;
    if (!slot) for (uint32_t j = 1; j < o->capacity; j++) {
        uint32_t i = o->flexible ? 1u + (o->next_slot - 1u + j - 1u) % (o->capacity - 1u) : j;
        if (!object_name(o, i)) { slot = i; break; }
    }
    if (slot) {
        void *p = (uint8_t *)o->base + o->stride * slot; zero(p, o->stride); *(uint32_t *)p = name;
        if (o->flexible) { o->live++; o->occupied++; o->next_slot = slot + 1u; if (o->next_slot == o->capacity) o->next_slot = 1; }
        index_name(o, slot); uint32_t live = object_live(o); if (live > o->peak) o->peak = live; return slot;
    }
    object_exhaustion(o->kind, "live object table", 1); return o->capacity;
}
static uint32_t new_name(GlObjects *o) {
    uint32_t name = o->flexible && o->next_name ? o->next_name : 1;
    while (find_name(o, name) != o->capacity ||
        ((o->base == shaders || o->base == programs) &&
        (SLOT(shaders, name) != N || SLOT(programs, name) != N))) { if (!++name) name = 1; }
    uint32_t slot = insert_name(o, name); if (o->flexible) o->next_name = name + 1;
    return slot == o->capacity ? 0 : slot;
}
#define alloc_name(a, stride) new_name(OBJECTS(a))
static uint32_t bind_name(GlObjects *o, uint32_t name) {
    uint32_t slot = find_name(o, name); return slot == o->capacity ? insert_name(o, name) : slot;
}
#define BIND(a, name) bind_name(OBJECTS(a), name)
/* Gen* is atomic on error: output memory and existing state are untouched. Only Create* returns0. */
static int gen_names(GlObjects *o, int32_t n) {
    if (n < 0) { fail(BAD_VALUE); return 0; }
    if (!n) return 1;
    if (o->flexible) {
        if (reserve_names(o, (uint32_t)n)) return 1;
        object_exhaustion(o->kind, "object table host memory", (uint32_t)n); return 0;
    }
    uint32_t free_slots = 0; for (uint32_t i = 1; i < o->capacity; i++) free_slots += object_name(o, i) == 0;
    if ((uint32_t)n > free_slots) { object_exhaustion(o->kind, "live object table", (uint32_t)n); return 0; }
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
