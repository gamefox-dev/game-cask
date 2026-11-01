/* Host driver for the GL profile's GLSL front end (platforms/win32/w32_glsl.h). Original CC0-1.0 test tool.
 * usage: glsl_driver [--vs FILE]... [--fs FILE]... [--attr NAME=LOC] [--frag NAME=LOC] [--pp] [--reflect-only]
 * Prints one JSON document with preprocessing, reflection and canonical output. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define GS_ALLOC(n) calloc(1, (n))
#define GS_FREE(p, n) ((void)(n), free(p))
#include "../../platforms/win32/w32_glsl.h"

static char *slurp(const char *path) {
    FILE *f = fopen(path, "rb"); if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)n + 1); if (fread(b, 1, (size_t)n, f) != (size_t)n) exit(2); b[n] = 0; fclose(f); return b;
}
static void json_str(const char *s) {
    putchar('"');
    for (; s && *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); } else if (c == '\n') fputs("\\n", stdout);
        else if (c == '\t') fputs("\\t", stdout); else if (c < 32) printf("\\u%04x", c); else putchar(c);
    }
    putchar('"');
}
typedef struct { GsLog log; char buf[8192]; GsPreprocessed pp; GsUnit *unit; int ok; } Stage;

static void run_stage(Stage *s, int stage, char **strs, int n, int *pp_only) {
    s->log.buf = s->buf; s->log.cap = sizeof s->buf;
    s->ok = gs_preprocess((const char *const *)strs, 0, n, &s->pp, &s->log);
    if (!s->ok || *pp_only) return;
    s->unit = calloc(1, sizeof(GsUnit));
    s->ok = gs_parse(s->unit, (uint32_t)stage, s->pp.text, s->pp.len, &s->log);
    if (s->ok) { gs_analyze(s->unit); s->ok = gs_policy(s->unit, &s->log); }
}
static void dump_stage(const char *key, Stage *s, int present) {
    printf("\"%s\":", key);
    if (!present) { fputs("null", stdout); return; }
    printf("{\"ok\":%s,\"log\":", s->ok ? "true" : "false"); json_str(s->buf);
    printf(",\"pp\":"); json_str(s->pp.text);
    printf(",\"version\":%u,\"es\":%d,\"core\":%d}", s->pp.version, s->pp.es, s->pp.core);
}
int main(int argc, char **argv) {
    char *vs_s[64], *fs_s[64]; int nvs = 0, nfs = 0, pp_only = 0;
    GpBinding ab[GP_MAX_BINDINGS], ob[GP_MAX_BINDINGS]; uint32_t nab = 0, nob = 0;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--vs") && i + 1 < argc) vs_s[nvs++] = slurp(argv[++i]);
        else if (!strcmp(argv[i], "--fs") && i + 1 < argc) fs_s[nfs++] = slurp(argv[++i]);
        else if (!strcmp(argv[i], "--pp")) pp_only = 1;
        else if (!strcmp(argv[i], "--reflect-only")) gs_reflect_only = 1;
        else if ((!strcmp(argv[i], "--attr") || !strcmp(argv[i], "--frag")) && i + 1 < argc) {
            char *eq = strchr(argv[++i], '='); if (!eq) return 2; *eq = 0;
            GpBinding *b = !strcmp(argv[i - 1], "--attr") ? &ab[nab++] : &ob[nob++];
            strncpy(b->name, argv[i], GS_NAME - 1); b->loc = (uint32_t)atoi(eq + 1);
        } else { fprintf(stderr, "bad argument %s\n", argv[i]); return 2; }
    }
    Stage vs, fs; memset(&vs, 0, sizeof vs); memset(&fs, 0, sizeof fs);
    if (nvs) run_stage(&vs, 1, vs_s, nvs, &pp_only);
    if (nfs) run_stage(&fs, 2, fs_s, nfs, &pp_only);
    putchar('{'); dump_stage("vs", &vs, nvs); putchar(','); dump_stage("fs", &fs, nfs);
    int ok = (!nvs || vs.ok) && (!nfs || fs.ok);
    if (pp_only || !ok) { printf(",\"linked\":false}\n"); return 0; }
    Gp *g = calloc(1, sizeof(Gp)); char lb[8192] = {0}; GsLog log = {lb, sizeof lb, 0, 0};
    int linked = gp_link(g, nvs ? vs.unit : 0, nfs ? fs.unit : 0, ab, nab, ob, nob, &log);
    printf(",\"linked\":%s,\"linkLog\":", linked ? "true" : "false"); json_str(lb);
    if (linked) {
        printf(",\"usize\":%u,\"slots\":%u,\"uniforms\":[", g->usize, g->nslots);
        for (uint32_t i = 0; i < g->nu; i++) {
            GpUniform *u = &g->u[i];
            printf("%s{\"name\":", i ? "," : ""); json_str(gp_name(g, u->name));
            printf(",\"type\":%u,\"size\":%d,\"location\":%d,\"block\":%d,\"offset\":%d,\"arrayStride\":%d,\"matrixStride\":%d,\"stages\":%u,\"slot\":%u}",
                u->gl_type, u->size, u->location, u->block, u->block >= 0 ? (int)u->offset : -1,
                u->block >= 0 ? (int)u->stride : -1, u->block >= 0 ? (int)u->mstride : -1, u->stages, u->slot);
        }
        printf("],\"blocks\":[");
        for (uint32_t i = 0; i < g->nb; i++) {
            printf("%s{\"name\":", i ? "," : ""); json_str(gp_name(g, g->b[i].name));
            printf(",\"size\":%u,\"members\":%u,\"stages\":%u}", g->b[i].size, g->b[i].nmembers, g->b[i].stages);
        }
        printf("],\"attribs\":[");
        for (uint32_t i = 0; i < g->na; i++) {
            printf("%s{\"name\":", i ? "," : ""); json_str(gp_name(g, g->a[i].name));
            printf(",\"type\":%u,\"size\":%d,\"location\":%d}", g->a[i].gl_type, g->a[i].size, g->a[i].location);
        }
        printf("],\"outputs\":[");
        for (uint32_t i = 0; i < g->no; i++) {
            printf("%s{\"name\":", i ? "," : ""); json_str(gp_name(g, g->o[i].name));
            printf(",\"type\":%u,\"size\":%d,\"location\":%d}", g->o[i].gl_type, g->o[i].size, g->o[i].location);
        }
        printf("]");
        for (int st = 0; st < 2; st++) {
            GsUnit *u = st ? (nfs ? fs.unit : 0) : (nvs ? vs.unit : 0); if (!u) continue;
            char eb[4096] = {0}; GsLog el = {eb, sizeof eb, 0, 0}; uint32_t len, cap;
            char *out = gs_emit(u, nvs ? vs.unit : 0, nfs ? fs.unit : 0, g, &el, &len, &cap);
            printf(",\"%sOut\":", st ? "fs" : "vs"); if (out) json_str(out); else fputs("null", stdout);
            printf(",\"%sEmitLog\":", st ? "fs" : "vs"); json_str(eb);
        }
    }
    puts("}"); return 0;
}
