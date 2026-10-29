/*
 * Coin Cave — Game Cask sample game (BGT ABI v0.1).
 *
 * Collect every coin in the cave while avoiding patrolling enemies.
 * Original code and assets, CC0-1.0. Simulation is integer-only and driven
 * by a fixed timestep, so identical input produces identical state hashes.
 */
#include "bgt.h"
#include "bgt_cmd.h"

#define LOGICAL_W 320
#define LOGICAL_H 180
#define HUD_H 20
#define TILE 16
#define COLS 20
#define ROWS 10
#define SUB 16                 /* subpixel units per pixel */
#define PLAYER_SIZE 12
#define PLAYER_SPEED 24        /* 1.5 px per update */
#define ENEMY_SIZE 12
#define ENEMY_SPEED 16         /* 1 px per update */
#define MAX_COINS 16
#define MAX_ENEMIES 8
#define START_LIVES 3
#define INVULN_FRAMES 90
#define COIN_SCORE 100
#define ATLAS 1u
#define ATLAS_W 256
#define ATLAS_H 64
#define FONT_Y 32

enum { ST_TITLE = 0, ST_PLAYING = 1, ST_WIN = 2, ST_GAMEOVER = 3 };
static const char *const STATE_NAMES[] = {"title", "playing", "win", "gameover"};

BGT_DEFINE_IO(io)

/* ------------------------------------------------------------- state */

typedef struct {
    int32_t x, y; /* subpixels, top-left, level space */
    int32_t dx, dy;
} enemy_t;

typedef struct {
    uint32_t state;
    uint32_t frame;
    uint32_t state_frames;
    int32_t px, py;
    int32_t lives;
    int32_t score;
    int32_t best;
    int32_t invuln;
    uint32_t coins_taken; /* bitmask */
    uint32_t coin_count;
    uint32_t enemy_count;
    int32_t coin_c[MAX_COINS], coin_r[MAX_COINS];
    enemy_t enemies[MAX_ENEMIES];
    int32_t spawn_x, spawn_y;
    uint32_t facing; /* 0 right, 1 left */
    uint32_t pointer_prev;
} game_t;

static game_t g;
static uint8_t level[ROWS][COLS];      /* 1 = wall */
static enemy_t enemy_spawn[MAX_ENEMIES];

static uint8_t atlas[ATLAS_W * ATLAS_H * 4];
typedef struct { int32_t x, y, w, h; } rect_t;
static rect_t spr_player, spr_enemy, spr_coin, spr_wall;

static uint32_t cmd_storage[64 * 1024 / 4];
static bgt_cmdbuf_t cb;

static int16_t sfx_buf[48000 / 2];

/* ------------------------------------------------------------- utils */

static void logs(uint32_t level_, const char *s) {
    uint32_t n = 0;
    while (s[n]) n++;
    bgt_log(level_, s, n);
}

static void fail(const char *s) {
    uint32_t n = 0;
    while (s[n]) n++;
    bgt_abort(BGT_E_INVALID, s, n);
}

static int streq(const char *a, uint32_t alen, const char *b) {
    uint32_t i = 0;
    for (; i < alen && b[i]; i++)
        if (a[i] != b[i]) return 0;
    return i == alen && b[i] == 0;
}

static uint8_t file_buf[16384];

/* Reads a whole asset into file_buf; returns its length. */
static uint32_t load_asset(const char *path) {
    uint32_t n = 0;
    while (path[n]) n++;
    int32_t h = bgt_asset_open(path, n);
    if (h <= 0) fail("missing asset");
    int32_t size = bgt_asset_size(h);
    if (size <= 0 || size >= (int32_t)sizeof(file_buf)) fail("asset too large");
    int32_t got = bgt_asset_read(h, file_buf, (uint32_t)size);
    bgt_asset_close(h);
    if (got != size) fail("short asset read");
    file_buf[size] = 0;
    return (uint32_t)size;
}

static int hexval(uint8_t c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* ------------------------------------------------------- asset parsing */

static void parse_level(void) {
    uint32_t len = load_asset("level.txt");
    uint32_t r = 0, c = 0;
    g.coin_count = 0;
    g.enemy_count = 0;
    for (uint32_t i = 0; i < len && r < ROWS; i++) {
        uint8_t ch = file_buf[i];
        if (ch == '\r') continue;
        if (ch == '\n') {
            if (c != COLS) fail("level row width");
            r++;
            c = 0;
            continue;
        }
        if (c >= COLS) fail("level row too long");
        level[r][c] = ch == '#';
        if (ch == 'P') {
            g.spawn_x = (int32_t)(c * TILE + (TILE - PLAYER_SIZE) / 2) * SUB;
            g.spawn_y = (int32_t)(r * TILE + (TILE - PLAYER_SIZE) / 2) * SUB;
        } else if (ch == 'C' && g.coin_count < MAX_COINS) {
            g.coin_c[g.coin_count] = (int32_t)c;
            g.coin_r[g.coin_count] = (int32_t)r;
            g.coin_count++;
        } else if ((ch == 'E' || ch == 'V') && g.enemy_count < MAX_ENEMIES) {
            enemy_t *e = &enemy_spawn[g.enemy_count++];
            e->x = (int32_t)(c * TILE + (TILE - ENEMY_SIZE) / 2) * SUB;
            e->y = (int32_t)(r * TILE + (TILE - ENEMY_SIZE) / 2) * SUB;
            e->dx = ch == 'E' ? ENEMY_SPEED : 0;
            e->dy = ch == 'V' ? ENEMY_SPEED : 0;
        }
        c++;
    }
    if (r != ROWS) fail("level row count");
}

static void parse_sprites(void) {
    uint32_t len = load_asset("sprites.txt");
    uint32_t pal[128];
    for (int i = 0; i < 128; i++) pal[i] = 0;
    int32_t cursor_x = 0;
    uint32_t i = 0;
    while (i < len) {
        /* read one line [i, e) */
        uint32_t e = i;
        while (e < len && file_buf[e] != '\n') e++;
        const char *line = (const char *)&file_buf[i];
        uint32_t n = e - i;
        if (n >= 10 && streq(line, 7, "palette")) {
            uint8_t key = (uint8_t)line[8];
            uint32_t v = 0;
            for (uint32_t k = 10; k < 18 && k < n; k++) v = (v << 4) | (uint32_t)hexval((uint8_t)line[k]);
            if (key < 128) pal[key] = v; /* RRGGBBAA */
        } else if (n > 7 && streq(line, 6, "sprite")) {
            /* sprite <name> <w> <h> */
            uint32_t k = 7, ns = k;
            while (k < n && line[k] != ' ') k++;
            uint32_t nl = k - ns;
            int32_t w = 0, h = 0;
            for (k++; k < n && line[k] != ' '; k++) w = w * 10 + (line[k] - '0');
            for (k++; k < n; k++) h = h * 10 + (line[k] - '0');
            if (w <= 0 || h <= 0 || cursor_x + w > ATLAS_W || h > FONT_Y) fail("bad sprite header");
            rect_t rc = {cursor_x, 0, w, h};
            uint32_t p = e + 1;
            for (int32_t row = 0; row < h; row++) {
                for (int32_t col = 0; col < w; col++) {
                    uint8_t ch = p + (uint32_t)col < len ? file_buf[p + (uint32_t)col] : '.';
                    uint32_t v = ch < 128 ? pal[ch] : 0;
                    uint8_t *px = &atlas[((row * ATLAS_W) + cursor_x + col) * 4];
                    px[0] = (uint8_t)(v >> 24);
                    px[1] = (uint8_t)(v >> 16);
                    px[2] = (uint8_t)(v >> 8);
                    px[3] = (uint8_t)v;
                }
                while (p < len && file_buf[p] != '\n') p++;
                p++;
            }
            e = p - 1;
            cursor_x += w + 1;
            if (streq(line + ns, nl, "player")) spr_player = rc;
            else if (streq(line + ns, nl, "enemy")) spr_enemy = rc;
            else if (streq(line + ns, nl, "coin")) spr_coin = rc;
            else if (streq(line + ns, nl, "wall")) spr_wall = rc;
        }
        i = e + 1;
    }
    if (!spr_player.w || !spr_enemy.w || !spr_coin.w || !spr_wall.w) fail("sprite sheet incomplete");
}

/* 3x5 font, rows encoded as 3-bit values (bit 2 = left column). */
static const char FONT_CHARS[] = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:/!-.";
static const uint8_t FONT[][5] = {
    {0, 0, 0, 0, 0},
    {7, 5, 5, 5, 7}, {2, 6, 2, 2, 7}, {7, 1, 7, 4, 7}, {7, 1, 7, 1, 7}, {5, 5, 7, 1, 1},
    {7, 4, 7, 1, 7}, {7, 4, 7, 5, 7}, {7, 1, 1, 1, 1}, {7, 5, 7, 5, 7}, {7, 5, 7, 1, 7},
    {2, 5, 7, 5, 5}, {6, 5, 6, 5, 6}, {3, 4, 4, 4, 3}, {6, 5, 5, 5, 6}, {7, 4, 6, 4, 7},
    {7, 4, 6, 4, 4}, {3, 4, 5, 5, 3}, {5, 5, 7, 5, 5}, {7, 2, 2, 2, 7}, {1, 1, 1, 5, 2},
    {5, 5, 6, 5, 5}, {4, 4, 4, 4, 7}, {5, 7, 7, 5, 5}, {6, 5, 5, 5, 5}, {2, 5, 5, 5, 2},
    {6, 5, 6, 4, 4}, {2, 5, 5, 6, 3}, {6, 5, 6, 5, 5}, {3, 4, 2, 1, 6}, {7, 2, 2, 2, 2},
    {5, 5, 5, 5, 7}, {5, 5, 5, 5, 2}, {5, 5, 7, 7, 5}, {5, 5, 2, 5, 5}, {5, 5, 2, 2, 2},
    {7, 1, 2, 4, 7}, {0, 2, 0, 2, 0}, {1, 1, 2, 4, 4}, {2, 2, 2, 0, 2}, {0, 0, 7, 0, 0},
    {0, 0, 0, 0, 2},
};

static void bake_font(void) {
    for (uint32_t gi = 0; gi < sizeof(FONT) / sizeof(FONT[0]); gi++) {
        for (int r = 0; r < 5; r++) {
            for (int c = 0; c < 3; c++) {
                if (!((FONT[gi][r] >> (2 - c)) & 1)) continue;
                uint8_t *px = &atlas[(((FONT_Y + r) * ATLAS_W) + (int)gi * 4 + c) * 4];
                px[0] = px[1] = px[2] = px[3] = 255;
            }
        }
    }
}

static int glyph_index(char ch) {
    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 32);
    for (int i = 0; FONT_CHARS[i]; i++)
        if (FONT_CHARS[i] == ch) return i;
    return 0;
}

/* ------------------------------------------------------------- audio */

static void play_tone(uint32_t hz0, uint32_t hz1, uint32_t ms, int16_t amp) {
    uint32_t rate = io.audio_sample_rate;
    if (!rate) return;
    uint32_t n = rate * ms / 1000;
    if (n > sizeof(sfx_buf) / sizeof(sfx_buf[0])) n = sizeof(sfx_buf) / sizeof(sfx_buf[0]);
    uint32_t phase = 0;
    for (uint32_t i = 0; i < n; i++) {
        uint32_t hz = (uint32_t)((int32_t)hz0 + ((int32_t)hz1 - (int32_t)hz0) * (int32_t)i / (int32_t)n);
        phase += (uint32_t)(((uint64_t)hz << 32) / rate);
        int32_t env = (int32_t)(n - i) * 256 / (int32_t)n;
        int32_t v = (phase & 0x80000000u) ? amp : -amp;
        sfx_buf[i] = (int16_t)(v * env / 256);
    }
    bgt_audio_push(sfx_buf, n);
}

/* ---------------------------------------------------------- simulation */

static int solid_at(int32_t px, int32_t py) { /* pixel coords */
    if (px < 0 || py < 0) return 1;
    int32_t c = px / TILE, r = py / TILE;
    if (c >= COLS || r >= ROWS) return 1;
    return level[r][c];
}

static int box_hits_wall(int32_t x, int32_t y, int32_t size) { /* subpixels */
    int32_t x0 = x / SUB, y0 = y / SUB, x1 = (x + size * SUB - 1) / SUB, y1 = (y + size * SUB - 1) / SUB;
    return solid_at(x0, y0) || solid_at(x1, y0) || solid_at(x0, y1) || solid_at(x1, y1);
}

static int overlap(int32_t ax, int32_t ay, int32_t as, int32_t bx, int32_t by, int32_t bs, int32_t inset) {
    return ax + inset < bx + bs - inset && bx + inset < ax + as - inset && ay + inset < by + bs - inset &&
           by + inset < ay + as - inset;
}

static void reset_round(void) {
    g.px = g.spawn_x;
    g.py = g.spawn_y;
    for (uint32_t i = 0; i < g.enemy_count; i++) g.enemies[i] = enemy_spawn[i];
}

static void new_game(void) {
    g.lives = START_LIVES;
    g.score = 0;
    g.coins_taken = 0;
    g.invuln = INVULN_FRAMES;
    reset_round();
}

static void set_state(uint32_t s) {
    g.state = s;
    g.state_frames = 0;
    const char *msg[] = {"state=title", "state=playing", "state=win", "state=gameover"};
    logs(BGT_LOG_INFO, msg[s]);
}

static void save_best(void) {
    if (g.score > g.best) {
        g.best = g.score;
        bgt_storage_write("best", 4, &g.best, sizeof(g.best));
    }
}

/* Move player one axis with corner assist: when blocked, slide up to 5 px
 * along the other axis toward an opening so 12 px sprites fit 16 px corridors. */
static void move_axis(int32_t dx, int32_t dy) {
    int32_t nx = g.px + dx, ny = g.py + dy;
    if (!box_hits_wall(nx, ny, PLAYER_SIZE)) {
        g.px = nx;
        g.py = ny;
        return;
    }
    for (int32_t off = SUB; off <= 5 * SUB; off += SUB) {
        for (int32_t sgn = -1; sgn <= 1; sgn += 2) {
            int32_t ox = dy ? sgn * off : 0, oy = dx ? sgn * off : 0;
            if (!box_hits_wall(nx + ox, ny + oy, PLAYER_SIZE) && !box_hits_wall(g.px + ox, g.py + oy, PLAYER_SIZE)) {
                int32_t step = SUB; /* nudge 1 px per update toward the opening */
                g.px += dy ? (ox > 0 ? step : -step) : 0;
                g.py += dx ? (oy > 0 ? step : -step) : 0;
                return;
            }
        }
    }
}

static void update_playing(void) {
    uint32_t b = io.buttons;
    int32_t dx = 0, dy = 0;
    if (b & BGT_BTN_LEFT) dx -= PLAYER_SPEED;
    if (b & BGT_BTN_RIGHT) dx += PLAYER_SPEED;
    if (b & BGT_BTN_UP) dy -= PLAYER_SPEED;
    if (b & BGT_BTN_DOWN) dy += PLAYER_SPEED;
    /* touch/pointer: hold on the playfield to walk toward that point */
    if (!dx && !dy && (io.pointer_buttons & 1) && io.pointer_inside && io.pointer_y >= HUD_H) {
        int32_t tx = io.pointer_x * SUB, ty = (io.pointer_y - HUD_H) * SUB;
        int32_t cx = g.px + PLAYER_SIZE * SUB / 2, cy = g.py + PLAYER_SIZE * SUB / 2;
        if (tx < cx - 2 * SUB) dx = -PLAYER_SPEED; else if (tx > cx + 2 * SUB) dx = PLAYER_SPEED;
        if (ty < cy - 2 * SUB) dy = -PLAYER_SPEED; else if (ty > cy + 2 * SUB) dy = PLAYER_SPEED;
    }
    if (dx) { move_axis(dx, 0); g.facing = dx < 0; }
    if (dy) move_axis(0, dy);

    for (uint32_t i = 0; i < g.enemy_count; i++) {
        enemy_t *e = &g.enemies[i];
        if (box_hits_wall(e->x + e->dx, e->y + e->dy, ENEMY_SIZE)) {
            e->dx = -e->dx;
            e->dy = -e->dy;
        } else {
            e->x += e->dx;
            e->y += e->dy;
        }
    }

    for (uint32_t i = 0; i < g.coin_count; i++) {
        if (g.coins_taken & (1u << i)) continue;
        int32_t cx = (g.coin_c[i] * TILE + 4) * SUB, cy = (g.coin_r[i] * TILE + 4) * SUB;
        if (overlap(g.px, g.py, PLAYER_SIZE * SUB, cx, cy, 8 * SUB, 0)) {
            g.coins_taken |= 1u << i;
            g.score += COIN_SCORE;
            logs(BGT_LOG_INFO, "coin");
            play_tone(880, 1760, 90, 5000);
        }
    }
    if (g.coins_taken == (1u << g.coin_count) - 1u) {
        save_best();
        play_tone(523, 1046, 400, 6000);
        set_state(ST_WIN);
        return;
    }

    if (g.invuln > 0) {
        g.invuln--;
    } else {
        for (uint32_t i = 0; i < g.enemy_count; i++) {
            enemy_t *e = &g.enemies[i];
            if (overlap(g.px, g.py, PLAYER_SIZE * SUB, e->x, e->y, ENEMY_SIZE * SUB, 2 * SUB)) {
                g.lives--;
                logs(BGT_LOG_INFO, "hit");
                play_tone(220, 55, 300, 7000);
                if (g.lives <= 0) {
                    save_best();
                    set_state(ST_GAMEOVER);
                } else {
                    g.invuln = INVULN_FRAMES;
                    reset_round();
                }
                return;
            }
        }
    }
}

/* ---------------------------------------------------------------- exports */

BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t io_ptr) {
    if (io_ptr != (uint32_t)(uintptr_t)&io) return BGT_E_INVALID;
    if (io.abi_version >> 16 != BGT_ABI_VERSION_MAJOR) return BGT_E_UNSUPPORTED;
    io.logical_width = LOGICAL_W;
    io.logical_height = LOGICAL_H;
    io.flags = BGT_FLAG_INTEGER_SCALE;

    __builtin_memset(&g, 0, sizeof g);
    parse_level();
    parse_sprites();
    bake_font();
    int32_t best = 0;
    if (bgt_storage_read("best", 4, &best, sizeof best) == (int32_t)sizeof best && best >= 0) g.best = best;

    bgt_cmd_init(&cb, cmd_storage, sizeof cmd_storage);
    bgt_cmd_tex_create(&cb, ATLAS, ATLAS_W, ATLAS_H);
    bgt_cmd_tex_update(&cb, ATLAS, 0, 0, ATLAS_W, ATLAS_H, atlas, sizeof atlas);
    int32_t rc = bgt_cmd_submit(&cb);
    if (rc != BGT_OK) return rc;

    new_game();
    set_state(ST_TITLE);
    logs(BGT_LOG_INFO, "coin cave ready");
    return BGT_OK;
}

BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt_us) {
    (void)dt_us; /* fixed timestep: simulation counts updates */
    g.frame++;
    g.state_frames++;
    uint32_t tap = (io.pointer_buttons & 1u) && !(g.pointer_prev & 1u) && io.pointer_inside;
    g.pointer_prev = io.pointer_buttons;
    uint32_t go = (io.buttons_pressed & (BGT_BTN_START | BGT_BTN_A)) || tap;
    if ((io.events & BGT_EVENT_AUDIO_UNLOCKED)) logs(BGT_LOG_DEBUG, "audio unlocked");
    switch (g.state) {
    case ST_TITLE:
        if (go) {
            new_game();
            set_state(ST_PLAYING);
        }
        break;
    case ST_PLAYING:
        update_playing();
        break;
    default:
        if (go && g.state_frames > 30) set_state(ST_TITLE);
        break;
    }
}

/* ------------------------------------------------------------- rendering */

static void sprite(rect_t r, float x, float y, float w, float h, uint32_t tint) {
    bgt_cmd_sprite(&cb, x, y, w, h, (float)r.x / ATLAS_W, (float)r.y / ATLAS_H, (float)(r.x + r.w) / ATLAS_W,
                   (float)(r.y + r.h) / ATLAS_H, tint);
}

static void text(float x, float y, float scale, const char *s, uint32_t tint) {
    for (; *s; s++, x += 4 * scale) {
        int gi = glyph_index(*s);
        if (!gi) continue;
        rect_t r = {gi * 4, FONT_Y, 3, 5};
        sprite(r, x, y, 3 * scale, 5 * scale, tint);
    }
}

static uint32_t text_len(const char *s) {
    uint32_t n = 0;
    while (s[n]) n++;
    return n;
}

static void text_center(float y, float scale, const char *s, uint32_t tint) {
    float w = (float)text_len(s) * 4 * scale - scale;
    text(((float)LOGICAL_W - w) / 2, y, scale, s, tint);
}

static char *fmt_num(char *dst, int32_t v, int digits) {
    for (int i = digits - 1; i >= 0; i--) {
        dst[i] = (char)('0' + (v % 10));
        v /= 10;
    }
    dst[digits] = 0;
    return dst + digits;
}

static void draw_level(void) {
    const uint32_t white = BGT_RGBA(255, 255, 255, 255);
    bgt_cmd_viewport(&cb, 0, HUD_H, LOGICAL_W, LOGICAL_H - HUD_H);
    for (int r = 0; r < ROWS; r++)
        for (int c = 0; c < COLS; c++)
            if (level[r][c]) sprite(spr_wall, (float)(c * TILE), (float)(r * TILE), TILE, TILE, white);
    for (uint32_t i = 0; i < g.coin_count; i++) {
        if (g.coins_taken & (1u << i)) continue;
        /* spin: squash width with a triangle wave (render-only, not simulation) */
        int32_t t = (int32_t)((g.frame + i * 7) % 40);
        int32_t tri = t < 20 ? t : 40 - t;
        float w = 2.0f + 6.0f * (float)tri / 20.0f;
        float cx = (float)(g.coin_c[i] * TILE + 8), cy = (float)(g.coin_r[i] * TILE + 4);
        sprite(spr_coin, cx - w / 2, cy, w, 8, white);
    }
    for (uint32_t i = 0; i < g.enemy_count; i++)
        sprite(spr_enemy, (float)(g.enemies[i].x / SUB), (float)(g.enemies[i].y / SUB), ENEMY_SIZE, ENEMY_SIZE, white);
    if (g.state == ST_PLAYING && !(g.invuln > 0 && (g.invuln / 4) % 2)) {
        float x = (float)(g.px / SUB), y = (float)(g.py / SUB);
        if (g.facing) /* mirror via negative width in uv */
            bgt_cmd_sprite(&cb, x, y, PLAYER_SIZE, PLAYER_SIZE, (float)(spr_player.x + spr_player.w) / ATLAS_W, 0,
                           (float)spr_player.x / ATLAS_W, (float)spr_player.h / ATLAS_H, white);
        else
            sprite(spr_player, x, y, PLAYER_SIZE, PLAYER_SIZE, white);
    }
    bgt_cmd_viewport(&cb, 0, 0, LOGICAL_W, LOGICAL_H);
}

static void draw_hud(void) {
    char buf[64], *p;
    bgt_cmd_scissor(&cb, 1, 0, 0, LOGICAL_W, HUD_H);
    bgt_cmd_clear(&cb, BGT_RGBA(24, 26, 48, 255));
    p = buf;
    const char *a = "SCORE ";
    while (*a) *p++ = *a++;
    p = fmt_num(p, g.score, 4);
    text(6, 7, 1, buf, BGT_RGBA(255, 255, 255, 255));
    p = buf;
    a = "LIVES ";
    while (*a) *p++ = *a++;
    fmt_num(p, g.lives < 0 ? 0 : g.lives, 1);
    text(120, 7, 1, buf, BGT_RGBA(255, 120, 130, 255));
    p = buf;
    a = "COINS ";
    while (*a) *p++ = *a++;
    uint32_t taken = 0;
    for (uint32_t i = 0; i < g.coin_count; i++) taken += (g.coins_taken >> i) & 1u;
    p = fmt_num(p, (int32_t)taken, 1);
    *p++ = '/';
    fmt_num(p, (int32_t)g.coin_count, 1);
    text(200, 7, 1, buf, BGT_RGBA(255, 215, 0, 255));
    bgt_cmd_scissor(&cb, 0, 0, 0, 0, 0);
}

static void draw_overlay(const char *title, uint32_t color, const char *sub) {
    bgt_cmd_blend(&cb, BGT_BLEND_ALPHA);
    bgt_cmd_texture(&cb, 0, BGT_FILTER_NEAREST);
    bgt_cmd_rect(&cb, 40, 52, 240, 84, BGT_RGBA(0, 0, 0, 180));
    bgt_cmd_texture(&cb, ATLAS, BGT_FILTER_NEAREST);
    /* scaled title via transform (exercises TRANSFORM) */
    float scale = 3.0f;
    float w = (float)text_len(title) * 4 * scale - scale;
    bgt_cmd_transform(&cb, scale, 0, 0, scale, ((float)LOGICAL_W - w) / 2, 64);
    text(0, 0, 1, title, color);
    bgt_cmd_identity(&cb);
    if (sub && (g.state_frames / 30) % 2 == 0) text_center(100, 2, sub, BGT_RGBA(255, 255, 255, 255));
}

BGT_EXPORT(bgt_render) void bgt_render(void) {
    bgt_cmd_clear(&cb, BGT_RGBA(14, 16, 30, 255));
    bgt_cmd_blend(&cb, BGT_BLEND_ALPHA);
    bgt_cmd_texture(&cb, ATLAS, BGT_FILTER_NEAREST);
    draw_level();
    draw_hud();
    char buf[32];
    switch (g.state) {
    case ST_TITLE:
        draw_overlay("COIN CAVE", BGT_RGBA(0, 220, 255, 255), "PRESS START");
        text_center(124, 1, "ARROWS/WASD MOVE  Z/ENTER START", BGT_RGBA(160, 170, 210, 255));
        {
            const char *a = "BEST ";
            char *p = buf;
            while (*a) *p++ = *a++;
            fmt_num(p, g.best, 4);
            text_center(40, 1, buf, BGT_RGBA(255, 215, 0, 255));
        }
        break;
    case ST_WIN:
        draw_overlay("YOU WIN!", BGT_RGBA(255, 215, 0, 255), "PRESS START");
        break;
    case ST_GAMEOVER:
        draw_overlay("GAME OVER", BGT_RGBA(255, 48, 64, 255), "PRESS START");
        break;
    default:
        break;
    }
    if (bgt_cmd_submit(&cb) != BGT_OK) logs(BGT_LOG_ERROR, "submit failed");
}

BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {
    save_best();
}

BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) {
    const uint8_t *p = (const uint8_t *)&g;
    uint32_t h = 2166136261u;
    for (uint32_t i = 0; i < sizeof g; i++) h = (h ^ p[i]) * 16777619u;
    return h;
}

/* ------------------------------------------------------------ debug state */

static char dbg[2048];
static uint32_t dbg_len;

static void dput(const char *s) {
    while (*s && dbg_len < sizeof dbg - 1) dbg[dbg_len++] = *s++;
}
static void dnum(int32_t v) {
    char tmp[12];
    int n = 0;
    uint32_t u = v < 0 ? (uint32_t)(-v) : (uint32_t)v;
    if (v < 0) dput("-");
    do { tmp[n++] = (char)('0' + u % 10); u /= 10; } while (u);
    while (n) { char c[2] = {tmp[--n], 0}; dput(c); }
}

BGT_EXPORT(bgt_debug_state) uint32_t bgt_debug_state(void) {
    dbg_len = 0;
    dput("{\"state\":\""); dput(STATE_NAMES[g.state]); dput("\"");
    dput(",\"frame\":"); dnum((int32_t)g.frame);
    dput(",\"player\":{\"x\":"); dnum(g.px / SUB); dput(",\"y\":"); dnum(g.py / SUB); dput("}");
    dput(",\"size\":"); dnum(PLAYER_SIZE);
    dput(",\"tile\":"); dnum(TILE);
    dput(",\"lives\":"); dnum(g.lives);
    dput(",\"score\":"); dnum(g.score);
    dput(",\"best\":"); dnum(g.best);
    dput(",\"invuln\":"); dnum(g.invuln);
    dput(",\"coins\":[");
    for (uint32_t i = 0; i < g.coin_count; i++) {
        if (i) dput(",");
        dput("{\"c\":"); dnum(g.coin_c[i]); dput(",\"r\":"); dnum(g.coin_r[i]);
        dput(",\"taken\":"); dput((g.coins_taken >> i) & 1u ? "true" : "false"); dput("}");
    }
    dput("],\"enemies\":[");
    for (uint32_t i = 0; i < g.enemy_count; i++) {
        if (i) dput(",");
        dput("{\"x\":"); dnum(g.enemies[i].x / SUB); dput(",\"y\":"); dnum(g.enemies[i].y / SUB); dput("}");
    }
    dput("]}");
    dbg[dbg_len] = 0;
    return (uint32_t)(uintptr_t)dbg;
}
