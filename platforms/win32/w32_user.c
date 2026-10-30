/*
 * Win32 profile: USER32 — window classes and windows, the message queue (GetMessage blocks with
 * bgt_yield), painting, timers, mouse/keyboard input from BGT, menus and accelerators from
 * resources, MessageBox, dialogs from DLGTEMPLATE(EX) resources with built-in BUTTON/STATIC/EDIT
 * controls, rect helpers, system metrics/colours.
 *
 * Model (documented deviations, INFERRED where noted):
 *   - Windows have no caption/border frame except dialogs (which draw a simple caption); the main
 *     window fills the BGT logical surface; AdjustWindowRect only adds the menu bar.
 *   - Z-order is creation order; painting a window re-invalidates overlapping windows above it.
 *   - Modal loops (MessageBox, DialogBox, menus) keep dispatching paint and timer messages.
 *
 * SPDX-License-Identifier: MIT
 */
#include "w32_int.h"

uint32_t w32_gdi_window_dc(uint32_t hwnd, int paint, int32_t l, int32_t t, int32_t r, int32_t b);
void w32_gdi_release_dc(uint32_t hdc);
void w32_gdi_fill_window(uint32_t hdc, int32_t l, int32_t t, int32_t r, int32_t b, uint32_t hbr);
uint32_t w32_draw_text(uint32_t hdc, const char *s, int32_t n, uint32_t rect, uint32_t fmt);
uint32_t w32_load_bitmap(uint32_t hmod, uint32_t name, int wide);

#define MENU_H 19
#define CAPTION_H 18
enum { B_NONE, B_BUTTON, B_STATIC, B_EDIT, B_OTHER };

/* ------------------------------------------------------------------ state */
typedef struct { int used; uint32_t style, proc, extra, inst, brush, menu_name; int menu_wide; char name[48]; } cls_t;
typedef struct {
    int used, destroyed, cls, builtin;
    uint32_t proc, parent, style, exstyle, id, menu, user, inst;
    int32_t x, y, w, h;      /* window rect (desktop) */
    int32_t cx, cy, cw, ch;  /* client rect (desktop) */
    int visible, enabled, sized;
    int inval, erase;
    int32_t il, it, ir, ib;  /* invalid rect (client coords) */
    char text[128];
    uint8_t extra[128];
    int is_dialog, dlg_ended, checked, pressed;
    uint32_t dlgproc, dlg_result, msgresult;
} wnd_t;
typedef struct { uint32_t hwnd, msg, wp, lp, time; int32_t x, y; } msg_t;
typedef struct { int used; uint32_t hwnd, id, ms, proc, due; } timer_t;
typedef struct { uint32_t flags, id, sub; char text[48]; } mitem_t;
typedef struct { int used, n; mitem_t it[32]; } menu_t;
typedef struct { uint8_t fvirt; uint16_t key, cmd; } accel_t;

static cls_t classes[NCLASS];
static wnd_t wnds[NWND];
static msg_t q[512];
static uint32_t qh, qt;
static timer_t timers[NTIMER];
static menu_t *menus;
#define NMENU 64
static accel_t accels[8][64];
static uint32_t naccel[8], naccel_tables;
static uint32_t main_hwnd, capture, focus, modal_hwnd;
static int quit_posted;
static uint32_t quit_code;
static uint32_t peeks_this_frame;
static uint8_t keystate[256];
static int32_t last_px = -1, last_py = -1;
static uint32_t last_pbuttons;
static uint32_t last_click_time, last_click_hwnd;
static int32_t last_click_x, last_click_y;
static uint32_t prev_keys[8];
static int cursor_shown = 0;
/* MessageBox */
static int mb_active, mb_result;
static uint32_t mb_type;
static char mb_text[256], mb_caption[64];
static int32_t mb_x, mb_y, mb_w, mb_h;
/* open popup menu */
static int menu_open = -1;
static uint32_t menu_open_handle;

static wnd_t *W(uint32_t h) { return (h > H_WND && h < H_WND + NWND && wnds[h - H_WND].used && !wnds[h - H_WND].destroyed) ? &wnds[h - H_WND] : 0; }
static menu_t *M(uint32_t h) { return (h >= H_MENU && h < H_MENU + NMENU && menus[h - H_MENU].used) ? &menus[h - H_MENU] : 0; }
uint32_t w32_user_main_hwnd(void) { return main_hwnd; }

uint32_t w32_sys_color(uint32_t i) {
    /* INFERRED: Windows XP "Luna" scheme values (COLORREF 0x00BBGGRR) */
    switch (i) {
    case 1: return 0x6b4f3a;                     /* COLOR_DESKTOP / BACKGROUND */
    case 5: case 14: return 0xffffff;            /* WINDOW, HIGHLIGHTTEXT */
    case 6: return 0x000000;                     /* WINDOWFRAME */
    case 7: case 8: case 9: case 18: return 0;   /* MENUTEXT, WINDOWTEXT, CAPTIONTEXT, BTNTEXT */
    case 2: return 0xe35400;                     /* ACTIVECAPTION */
    case 4: case 15: case 22: return 0xd8e9ec;   /* MENU, BTNFACE, 3DLIGHT */
    case 16: return 0x99a8ac;                    /* BTNSHADOW */
    case 17: return 0x808080;                    /* GRAYTEXT */
    case 20: return 0xffffff;                    /* BTNHIGHLIGHT */
    case 21: return 0x646f71;                    /* 3DDKSHADOW */
    case 13: return 0xc56a31;                    /* HIGHLIGHT */
    default: return 0xc0c0c0;
    }
}

/* ------------------------------------------------------------------ geometry */
int32_t w32_user_menu_h(uint32_t hwnd) { wnd_t *w = W(hwnd); return w && w->menu && !(w->style & 0x40000000u) ? MENU_H : 0; }
static void recalc_client(wnd_t *w, uint32_t h) {
    int32_t top = w32_user_menu_h(h) + (w->is_dialog ? CAPTION_H : 0);
    int32_t bd = w->is_dialog ? 2 : 0;
    w->cx = w->x + bd; w->cy = w->y + top + bd; w->cw = imax(0, w->w - 2 * bd); w->ch = imax(0, w->h - top - 2 * bd);
}
int w32_user_client(uint32_t hwnd, int32_t *x, int32_t *y, int32_t *w, int32_t *h) {
    wnd_t *p = W(hwnd);
    if (!p) return 0;
    *x = p->cx; *y = p->cy; *w = p->cw; *h = p->ch;
    return 1;
}
void w32_user_window_rect(uint32_t hwnd, int32_t *x, int32_t *y, int32_t *w, int32_t *h) {
    wnd_t *p = W(hwnd);
    if (!p) { *x = *y = 0; *w = w32_gdi_screen_w(); *h = w32_gdi_screen_h(); return; }
    *x = p->x; *y = p->y; *w = p->w; *h = p->h;
}
static uint32_t hwnd_of(wnd_t *w) { return H_WND + (uint32_t)(w - wnds); }

static void invalidate(wnd_t *w, int32_t l, int32_t t, int32_t r, int32_t b, int erase) {
    l = imax(l, 0); t = imax(t, 0); r = imin(r, w->cw); b = imin(b, w->ch);
    if (r <= l || b <= t) return;
    if (!w->inval) { w->il = l; w->it = t; w->ir = r; w->ib = b; }
    else { w->il = imin(w->il, l); w->it = imin(w->it, t); w->ir = imax(w->ir, r); w->ib = imax(w->ib, b); }
    w->inval = 1;
    w->erase |= erase;
}
void w32_user_invalidate_all(void) {
    for (int i = 1; i < NWND; i++) if (wnds[i].used && !wnds[i].destroyed && wnds[i].visible) invalidate(&wnds[i], 0, 0, wnds[i].cw, wnds[i].ch, 1);
}
void w32_user_targets_lost(void) { w32_user_invalidate_all(); }
/* after drawing into window `w`, windows above it that overlap must be repainted */
static void raise_above(wnd_t *w) {
    for (int i = (int)(w - wnds) + 1; i < NWND; i++) {
        wnd_t *o = &wnds[i];
        if (!o->used || o->destroyed || !o->visible) continue;
        if (o->x < w->x + w->w && o->x + o->w > w->x && o->y < w->y + w->h && o->y + o->h > w->y) invalidate(o, 0, 0, o->cw, o->ch, 1);
    }
}

/* ------------------------------------------------------------------ messages */
static void post(uint32_t hwnd, uint32_t msg, uint32_t wp, uint32_t lp) {
    uint32_t n = (qt + 1) & 511u;
    if (n == qh) return;
    q[qt] = (msg_t){hwnd, msg, wp, lp, w32_now_ms(), last_px, last_py};
    qt = n;
    w32_m.messages++;
}
static uint32_t builtin_proc(wnd_t *w, uint32_t msg, uint32_t wp, uint32_t lp);
static uint32_t dialog_default(wnd_t *w, uint32_t msg, uint32_t wp, uint32_t lp);
static uint32_t def_proc(uint32_t hwnd, uint32_t msg, uint32_t wp, uint32_t lp);

static uint32_t send(uint32_t hwnd, uint32_t msg, uint32_t wp, uint32_t lp) {
    wnd_t *w = W(hwnd);
    if (!w) return 0;
    if (w->builtin) return builtin_proc(w, msg, wp, lp);
    if (w->is_dialog) {
        uint32_t args[4] = {hwnd, msg, wp, lp};
        uint32_t r = w->dlgproc ? x86_callback(w->dlgproc, 4, args) : 0;
        if (W(hwnd) && r) return (msg == 0x110 || msg == 0x111) ? r : (w->msgresult ? w->msgresult : r);
        return W(hwnd) ? dialog_default(w, msg, wp, lp) : 0;
    }
    if (!w->proc) return def_proc(hwnd, msg, wp, lp);
    uint32_t args[4] = {hwnd, msg, wp, lp};
    return x86_callback(w->proc, 4, args);
}

static int match(const msg_t *m, uint32_t hwnd, uint32_t lo, uint32_t hi) {
    if (hwnd && m->hwnd != hwnd) { wnd_t *w = W(m->hwnd); if (!w || w->parent != hwnd) return 0; }
    if ((lo || hi) && (m->msg < lo || m->msg > hi)) return 0;
    return 1;
}
/* paint message for the first invalid visible window (parents before children, lower z first) */
static int paint_msg(msg_t *out, uint32_t hwnd) {
    for (int i = 1; i < NWND; i++) {
        wnd_t *w = &wnds[i];
        if (!w->used || w->destroyed || !w->visible || !w->inval) continue;
        if (hwnd && hwnd_of(w) != hwnd && w->parent != hwnd) continue;
        *out = (msg_t){hwnd_of(w), 0x000f, 0, 0, w32_now_ms(), last_px, last_py};
        return 1;
    }
    return 0;
}
static int next_msg(msg_t *out, uint32_t hwnd, uint32_t lo, uint32_t hi, int remove) {
    for (uint32_t i = qh; i != qt; i = (i + 1) & 511u) {
        if (!match(&q[i], hwnd, lo, hi)) continue;
        *out = q[i];
        if (remove) { /* delete i by shifting the rest */
            uint32_t j = i;
            while (((j + 1) & 511u) != qt) { q[j] = q[(j + 1) & 511u]; j = (j + 1) & 511u; }
            qt = (qt - 1) & 511u;
        }
        return 1;
    }
    if ((!lo && !hi) || (0x000f >= lo && 0x000f <= hi)) if (paint_msg(out, hwnd)) return 1;
    return 0;
}
static void write_msg(uint32_t p, const msg_t *m) {
    x86_wr32(p, m->hwnd); x86_wr32(p + 4, m->msg); x86_wr32(p + 8, m->wp); x86_wr32(p + 12, m->lp);
    x86_wr32(p + 16, m->time); x86_wr32(p + 20, (uint32_t)m->x); x86_wr32(p + 24, (uint32_t)m->y);
}
static void dispatch(const msg_t *m) {
    if (m->msg == 0x0113 && m->lp) { /* WM_TIMER with TIMERPROC */
        uint32_t args[4] = {m->hwnd, 0x0113, m->wp, w32_now_ms()};
        x86_callback(m->lp, 4, args);
        return;
    }
    send(m->hwnd, m->msg, m->wp, m->lp);
}
/* used by modal loops: run paints/timers/non-input messages until a frame boundary */
static void pump_nonblocking(void) {
    msg_t m;
    for (int n = 0; n < 64 && next_msg(&m, 0, 0, 0, 1); n++) dispatch(&m);
}
static void modal_wait(int *done) {
    while (!*done) {
        pump_nonblocking();
        if (*done) break;
        w32_wait_frame();
    }
}

static uint32_t u_GetMessage(void) {
    uint32_t p = ARG(0), hwnd = ARG(1), lo = ARG(2), hi = ARG(3);
    msg_t m;
    for (;;) {
        if (next_msg(&m, hwnd, lo, hi, 1)) { write_msg(p, &m); return m.msg != 0x0012; }
        if (quit_posted) { m = (msg_t){0, 0x0012, quit_code, 0, w32_now_ms(), last_px, last_py}; write_msg(p, &m); return 0; }
        w32_wait_frame();
    }
}
static uint32_t u_PeekMessage(void) {
    uint32_t p = ARG(0), hwnd = ARG(1), lo = ARG(2), hi = ARG(3), flags = ARG(4);
    msg_t m;
    if (next_msg(&m, hwnd, lo, hi, (flags & 1u) != 0)) { write_msg(p, &m); return 1; }
    if (quit_posted) { m = (msg_t){0, 0x0012, quit_code, 0, w32_now_ms(), last_px, last_py}; write_msg(p, &m); if (flags & 1u) quit_posted = 0; return 1; }
    /* a busy PeekMessage loop would never let the frame end: yield after many empty peeks */
    if (++peeks_this_frame > 64) { w32_m.peek_yields++; w32_wait_frame(); }
    return 0;
}
static uint32_t u_WaitMessage(void) { w32_wait_frame(); return 1; }
static uint32_t u_MsgWaitForMultipleObjects(void) {
    if (qh == qt) w32_wait_frame();
    return ARG(0); /* WAIT_OBJECT_0 + nCount: input available */
}
static uint32_t u_TranslateMessage(void) {
    uint32_t p = ARG(0), msg = x86_rd32(p + 4), vk = x86_rd32(p + 8);
    if (msg != 0x0100) return 0;
    uint32_t ch = 0;
    int shift = keystate[0x10] & 0x80;
    if (vk >= 'A' && vk <= 'Z') ch = shift ? vk : vk + 32;
    else if (vk >= '0' && vk <= '9') ch = vk;
    else if (vk == 0x20 || vk == 0x0d || vk == 0x1b || vk == 0x08 || vk == 0x09) ch = vk;
    if (ch) post(x86_rd32(p), 0x0102, ch, x86_rd32(p + 12));
    return ch != 0;
}
static uint32_t u_DispatchMessage(void) {
    uint32_t p = ARG(0);
    msg_t m = {x86_rd32(p), x86_rd32(p + 4), x86_rd32(p + 8), x86_rd32(p + 12), x86_rd32(p + 16), (int32_t)x86_rd32(p + 20), (int32_t)x86_rd32(p + 24)};
    dispatch(&m);
    return 0;
}
static uint32_t u_SendMessage(void) { return send(ARG(0), ARG(1), ARG(2), ARG(3)); }
static uint32_t u_PostMessage(void) { if (ARG(0) && !W(ARG(0))) return 0; post(ARG(0), ARG(1), ARG(2), ARG(3)); return 1; }
static uint32_t u_PostQuitMessage(void) { quit_posted = 1; quit_code = ARG(0); return 0; }
static uint32_t u_CallWindowProc(void) {
    uint32_t fn = ARG(0), args[4] = {ARG(1), ARG(2), ARG(3), ARG(4)};
    if (!fn) return def_proc(args[0], args[1], args[2], args[3]);
    return x86_callback(fn, 4, args);
}

/* ------------------------------------------------------------------ painting */
static uint32_t begin_paint(uint32_t hwnd, uint32_t ps) {
    wnd_t *w = W(hwnd);
    if (!w) return 0;
    w32_m.paints++;
    int32_t l = 0, t = 0, r = w->cw, b = w->ch;
    if (w->inval) { l = w->il; t = w->it; r = w->ir; b = w->ib; }
    int erase = w->erase;
    w->inval = 0; w->erase = 0;
    uint32_t hdc = w32_gdi_window_dc(hwnd, 1, l, t, r, b);
    int ferase = 0;
    if (erase) ferase = send(hwnd, 0x0014, hdc, 0) == 0; /* WM_ERASEBKGND */
    x86_wr32(ps, hdc); x86_wr32(ps + 4, (uint32_t)ferase);
    x86_wr32(ps + 8, (uint32_t)l); x86_wr32(ps + 12, (uint32_t)t); x86_wr32(ps + 16, (uint32_t)r); x86_wr32(ps + 20, (uint32_t)b);
    raise_above(w);
    return hdc;
}
static uint32_t u_BeginPaint(void) { return begin_paint(ARG(0), ARG(1)); }
static uint32_t u_EndPaint(void) { w32_gdi_release_dc(x86_rd32(ARG(1))); return 1; }
static uint32_t u_GetDC(void) { return w32_gdi_window_dc(ARG(0), 0, 0, 0, 0, 0); }
static uint32_t u_ReleaseDC(void) { wnd_t *w = W(ARG(0)); if (w) raise_above(w); w32_gdi_release_dc(ARG(1)); return 1; }
static uint32_t u_InvalidateRect(void) {
    wnd_t *w = W(ARG(0));
    if (!ARG(0)) { w32_user_invalidate_all(); return 1; }
    if (!w) return 0;
    uint32_t r = ARG(1);
    if (r) invalidate(w, (int32_t)x86_rd32(r), (int32_t)x86_rd32(r + 4), (int32_t)x86_rd32(r + 8), (int32_t)x86_rd32(r + 12), (int)ARG(2));
    else invalidate(w, 0, 0, w->cw, w->ch, (int)ARG(2));
    return 1;
}
static uint32_t u_ValidateRect(void) { wnd_t *w = W(ARG(0)); if (w) { w->inval = 0; w->erase = 0; } return 1; }
static uint32_t u_UpdateWindow(void) { wnd_t *w = W(ARG(0)); if (w && w->inval && w->visible) send(ARG(0), 0x000f, 0, 0); return 1; }
static uint32_t u_GetUpdateRect(void) {
    wnd_t *w = W(ARG(0));
    if (!w || !w->inval) { if (ARG(1)) for (int i = 0; i < 4; i++) x86_wr32(ARG(1) + 4u * (uint32_t)i, 0); return 0; }
    if (ARG(1)) { x86_wr32(ARG(1), (uint32_t)w->il); x86_wr32(ARG(1) + 4, (uint32_t)w->it); x86_wr32(ARG(1) + 8, (uint32_t)w->ir); x86_wr32(ARG(1) + 12, (uint32_t)w->ib); }
    return 1;
}
static uint32_t u_RedrawWindow(void) {
    wnd_t *w = W(ARG(0));
    if (!w) return 1;
    invalidate(w, 0, 0, w->cw, w->ch, (ARG(3) & 4u) != 0);
    if (ARG(3) & 0x100u) send(ARG(0), 0x000f, 0, 0); /* RDW_UPDATENOW */
    return 1;
}

static uint32_t def_proc(uint32_t hwnd, uint32_t msg, uint32_t wp, uint32_t lp) {
    wnd_t *w = W(hwnd);
    (void)lp;
    switch (msg) {
    case 0x0010: send(hwnd, 0x0002, 0, 0); if (W(hwnd)) W(hwnd)->destroyed = 1; return 0; /* WM_CLOSE -> destroy */
    case 0x0014: { /* WM_ERASEBKGND: class brush */
        if (!w) return 0;
        uint32_t br = classes[w->cls].brush;
        if (!br) return 0;
        w32_gdi_fill_window(wp, 0, 0, w->cw, w->ch, br);
        return 1;
    }
    case 0x000f: { /* WM_PAINT: BeginPaint/EndPaint (erases with the class brush, validates) */
        if (!w) return 0;
        static uint32_t ps;
        if (!ps) ps = w32_misc_alloc(64);
        w32_gdi_release_dc(begin_paint(hwnd, ps));
        return 0;
    }
    case 0x0112: if ((wp & 0xfff0u) == 0xf060u) post(hwnd, 0x0010, 0, 0); return 0; /* SC_CLOSE */
    case 0x0084: return 1;  /* WM_NCHITTEST: HTCLIENT */
    case 0x0020: return 0;  /* WM_SETCURSOR */
    case 0x000d: { /* WM_GETTEXT */
        if (!w) return 0;
        return w32_pstr(lp, wp, 1, w->text);
    }
    case 0x000c: if (w) w32_gstr(lp, 1, w->text, sizeof w->text); return 1; /* WM_SETTEXT */
    default: return 0;
    }
}
static uint32_t u_DefWindowProc(void) { return def_proc(ARG(0), ARG(1), ARG(2), ARG(3)); }

/* ------------------------------------------------------------------ classes + windows */
static int find_class(uint32_t name, int wide) {
    char n[48];
    if (name < 0x10000u) {
        for (int i = 0; i < NCLASS; i++) if (classes[i].used && 0xc000u + (uint32_t)i == name) return i;
        return -1;
    }
    w32_gstr(name, wide, n, sizeof n);
    for (int i = 0; i < NCLASS; i++) if (classes[i].used && w32_streqi(classes[i].name, n)) return i;
    return -1;
}
static uint32_t reg_class(uint32_t wc, int ex, int wide) {
    uint32_t o = ex ? 4 : 0;
    for (int i = 1; i < NCLASS; i++) {
        if (classes[i].used) continue;
        cls_t *c = &classes[i];
        c->used = 1;
        c->style = x86_rd32(wc + o); c->proc = x86_rd32(wc + o + 4); c->extra = x86_rd32(wc + o + 12);
        c->inst = x86_rd32(wc + o + 16); c->brush = x86_rd32(wc + o + 28); c->menu_name = x86_rd32(wc + o + 32); c->menu_wide = wide;
        uint32_t nm = x86_rd32(wc + o + 36);
        if (nm < 0x10000u) { c->name[0] = '#'; c->name[1] = 0; } else w32_gstr(nm, wide, c->name, sizeof c->name);
        return 0xc000u + (uint32_t)i;
    }
    return 0;
}
static uint32_t u_RegisterClassA(void) { return reg_class(ARG(0), 0, 0); }
static uint32_t u_RegisterClassW(void) { return reg_class(ARG(0), 0, 1); }
static uint32_t u_RegisterClassExA(void) { return reg_class(ARG(0), 1, 0); }
static uint32_t u_RegisterClassExW(void) { return reg_class(ARG(0), 1, 1); }

static uint32_t load_menu(uint32_t hmod, uint32_t name, int wide);
static int builtin_kind(const char *cls) {
    if (w32_streqi(cls, "button")) return B_BUTTON;
    if (w32_streqi(cls, "static")) return B_STATIC;
    if (w32_streqi(cls, "edit")) return B_EDIT;
    if (w32_streqi(cls, "listbox") || w32_streqi(cls, "combobox") || w32_streqi(cls, "scrollbar")) return B_OTHER;
    return B_NONE;
}
static uint32_t new_window(uint32_t exstyle, int cls, int builtin, const char *title, uint32_t style, int32_t x, int32_t y, int32_t w, int32_t h,
                           uint32_t parent, uint32_t menu_or_id, uint32_t inst) {
    for (int i = 1; i < NWND; i++) {
        if (wnds[i].used) continue;
        wnd_t *p = &wnds[i];
        __builtin_memset(p, 0, sizeof *p);
        p->used = 1; p->cls = cls; p->builtin = builtin; p->enabled = !(style & 0x08000000u);
        p->proc = cls >= 0 && !builtin ? classes[cls].proc : 0;
        p->style = style; p->exstyle = exstyle; p->parent = parent; p->inst = inst;
        uint32_t k = 0;
        for (; title && title[k] && k < 127; k++) p->text[k] = title[k];
        p->text[k] = 0;
        int child = (style & 0x40000000u) != 0;
        if (child) p->id = menu_or_id;
        else p->menu = menu_or_id;
        if (!child && !p->menu && cls >= 0 && classes[cls].menu_name) p->menu = load_menu(inst, classes[cls].menu_name, classes[cls].menu_wide);
        if ((uint32_t)x == 0x80000000u) x = 0;
        if ((uint32_t)y == 0x80000000u) y = 0;
        if ((uint32_t)w == 0x80000000u) w = 640;
        if ((uint32_t)h == 0x80000000u) h = 480;
        wnd_t *par = W(parent);
        if (child && par) { x += par->cx; y += par->cy; }
        p->x = x; p->y = y; p->w = w; p->h = h;
        recalc_client(p, H_WND + (uint32_t)i);
        return H_WND + (uint32_t)i;
    }
    x86_fault("window table full", 0);
}
static void size_main(wnd_t *w) {
    /* the main window defines the desktop: put it at the origin and size the BGT surface to it */
    w->x = 0; w->y = 0;
    recalc_client(w, main_hwnd);
    w32_gdi_screen(w->w, w->h);
}
static uint32_t create_window(int wide) {
    uint32_t exstyle = ARG(0), cname = ARG(1), tname = ARG(2), style = ARG(3);
    int32_t x = (int32_t)ARG(4), y = (int32_t)ARG(5), w = (int32_t)ARG(6), h = (int32_t)ARG(7);
    uint32_t parent = ARG(8), menu = ARG(9), inst = ARG(10), param = ARG(11);
    char title[128], cn[48] = "";
    w32_gstr(tname, wide, title, sizeof title);
    int cls = find_class(cname, wide);
    int builtin = B_NONE;
    if (cls < 0) {
        if (cname >= 0x10000u) w32_gstr(cname, wide, cn, sizeof cn);
        builtin = builtin_kind(cn);
        if (!builtin) { w32_logf2("win32 profile: unknown window class ", cn); return 0; }
    }
    uint32_t hwnd = new_window(exstyle, cls, builtin, title, style, x, y, w, h, parent, menu, inst);
    wnd_t *p = W(hwnd);
    int top = !(style & 0x40000000u);
    if (top && !main_hwnd && !builtin) { main_hwnd = hwnd; size_main(p); focus = hwnd; }
    /* CREATESTRUCT for WM_NCCREATE / WM_CREATE */
    static uint32_t cs_buf[4];
    static uint32_t cs_depth;
    if (cs_depth >= 4) x86_fault("CreateWindow nested too deeply", 0);
    if (!cs_buf[cs_depth]) cs_buf[cs_depth] = w32_misc_alloc(48);
    uint32_t cs = cs_buf[cs_depth++]; /* windows created from WM_CREATE need their own CREATESTRUCT */
    x86_wr32(cs, param); x86_wr32(cs + 4, inst); x86_wr32(cs + 8, menu); x86_wr32(cs + 12, parent);
    x86_wr32(cs + 16, (uint32_t)p->h); x86_wr32(cs + 20, (uint32_t)p->w); x86_wr32(cs + 24, (uint32_t)p->y); x86_wr32(cs + 28, (uint32_t)p->x);
    x86_wr32(cs + 32, style); x86_wr32(cs + 36, tname); x86_wr32(cs + 40, cname); x86_wr32(cs + 44, exstyle);
    send(hwnd, 0x0081, 0, cs); /* WM_NCCREATE */
    int32_t created = (int32_t)send(hwnd, 0x0001, 0, cs); /* WM_CREATE */
    cs_depth--;
    if (created == -1) { if (W(hwnd)) W(hwnd)->destroyed = 1; return 0; }
    p = W(hwnd);
    if (!p) return 0;
    if (style & 0x10000000u) { p->visible = 1; invalidate(p, 0, 0, p->cw, p->ch, 1); }
    if (!top || (style & 0x10000000u)) { /* children (and visible top-levels) get their size right away */
        p->sized = 1;
        send(hwnd, 0x0005, 0, ((uint32_t)p->ch << 16) | ((uint32_t)p->cw & 0xffffu));
    }
    return hwnd;
}
static uint32_t u_CreateWindowExA(void) { return create_window(0); }
static uint32_t u_CreateWindowExW(void) { return create_window(1); }
static void destroy(uint32_t hwnd) {
    wnd_t *w = W(hwnd);
    if (!w) return;
    for (int i = 1; i < NWND; i++) if (wnds[i].used && !wnds[i].destroyed && wnds[i].parent == hwnd) destroy(H_WND + (uint32_t)i);
    send(hwnd, 0x0002, 0, 0); /* WM_DESTROY */
    if ((w = W(hwnd))) { w->destroyed = 1; w->used = 0; }
    for (int i = 0; i < NTIMER; i++) if (timers[i].used && timers[i].hwnd == hwnd) timers[i].used = 0;
    if (capture == hwnd) capture = 0;
    if (focus == hwnd) focus = main_hwnd;
    w32_user_invalidate_all();
}
static uint32_t u_DestroyWindow(void) { destroy(ARG(0)); return 1; }
static uint32_t u_ShowWindow(void) {
    wnd_t *w = W(ARG(0));
    if (!w) return 0;
    int was = w->visible;
    w->visible = ARG(1) != 0;
    if (w->visible && !was) {
        invalidate(w, 0, 0, w->cw, w->ch, 1);
        if (!w->sized) { w->sized = 1; send(ARG(0), 0x0005, 0, ((uint32_t)w->ch << 16) | ((uint32_t)w->cw & 0xffffu)); }
    }
    if (!w->visible && was) w32_user_invalidate_all();
    return (uint32_t)was;
}
static void move_window(uint32_t hwnd, int32_t x, int32_t y, int32_t cw, int32_t ch, int move, int size) {
    wnd_t *w = W(hwnd);
    if (!w) return;
    wnd_t *par = W(w->parent);
    if (move) {
        if ((w->style & 0x40000000u) && par) { x += par->cx; y += par->cy; }
        int32_t dx = x - w->x, dy = y - w->y;
        if (dx || dy) for (int i = 1; i < NWND; i++) if (wnds[i].used && wnds[i].parent == hwnd) { wnds[i].x += dx; wnds[i].y += dy; recalc_client(&wnds[i], H_WND + (uint32_t)i); }
        w->x = x; w->y = y;
    }
    if (size) { w->w = cw; w->h = ch; }
    if (hwnd == main_hwnd) size_main(w); else recalc_client(w, hwnd);
    invalidate(w, 0, 0, w->cw, w->ch, 1);
    if (size) { w->sized = 1; send(hwnd, 0x0005, 0, ((uint32_t)w->ch << 16) | ((uint32_t)w->cw & 0xffffu)); }
}
static uint32_t u_MoveWindow(void) { move_window(ARG(0), (int32_t)ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), 1, 1); return 1; }
static uint32_t u_SetWindowPos(void) {
    uint32_t f = ARG(6);
    move_window(ARG(0), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4), (int32_t)ARG(5), !(f & 2u), !(f & 1u));
    if (f & 0x40u) { wnd_t *w = W(ARG(0)); if (w) { w->visible = 1; invalidate(w, 0, 0, w->cw, w->ch, 1); } }
    if (f & 0x80u) { wnd_t *w = W(ARG(0)); if (w) { w->visible = 0; w32_user_invalidate_all(); } }
    return 1;
}
static void put_rect(uint32_t p, int32_t l, int32_t t, int32_t r, int32_t b) { x86_wr32(p, (uint32_t)l); x86_wr32(p + 4, (uint32_t)t); x86_wr32(p + 8, (uint32_t)r); x86_wr32(p + 12, (uint32_t)b); }
static uint32_t u_GetClientRect(void) { wnd_t *w = W(ARG(0)); if (!w) { put_rect(ARG(1), 0, 0, w32_gdi_screen_w(), w32_gdi_screen_h()); return ARG(0) == 0 || ARG(0) == H_WND; } put_rect(ARG(1), 0, 0, w->cw, w->ch); return 1; }
static uint32_t u_GetWindowRect(void) { int32_t x, y, w, h; w32_user_window_rect(ARG(0), &x, &y, &w, &h); put_rect(ARG(1), x, y, x + w, y + h); return 1; }
static uint32_t u_ClientToScreen(void) { wnd_t *w = W(ARG(0)); if (!w) return 0; x86_wr32(ARG(1), x86_rd32(ARG(1)) + (uint32_t)w->cx); x86_wr32(ARG(1) + 4, x86_rd32(ARG(1) + 4) + (uint32_t)w->cy); return 1; }
static uint32_t u_ScreenToClient(void) { wnd_t *w = W(ARG(0)); if (!w) return 0; x86_wr32(ARG(1), x86_rd32(ARG(1)) - (uint32_t)w->cx); x86_wr32(ARG(1) + 4, x86_rd32(ARG(1) + 4) - (uint32_t)w->cy); return 1; }
static uint32_t u_AdjustWindowRect(void) {
    if (ARG(2)) x86_wr32(ARG(0) + 4, x86_rd32(ARG(0) + 4) - MENU_H);
    return 1;
}
static uint32_t u_AdjustWindowRectEx(void) { return u_AdjustWindowRect(); }
static uint32_t u_GetDesktopWindow(void) { return H_WND; }
static uint32_t u_IsWindow(void) { return W(ARG(0)) != 0; }
static uint32_t u_IsWindowVisible(void) { wnd_t *w = W(ARG(0)); return w && w->visible; }
static uint32_t u_IsWindowEnabled(void) { wnd_t *w = W(ARG(0)); return w && w->enabled; }
static uint32_t u_EnableWindow(void) { wnd_t *w = W(ARG(0)); if (!w) return 0; uint32_t was = !w->enabled; w->enabled = ARG(1) != 0; invalidate(w, 0, 0, w->cw, w->ch, 1); return was; }
static uint32_t u_zero(void) { return 0; }
static uint32_t u_one(void) { return 1; }
static uint32_t u_GetParent(void) { wnd_t *w = W(ARG(0)); return w ? w->parent : 0; }
static uint32_t u_SetFocus(void) { uint32_t o = focus; if (W(ARG(0))) focus = ARG(0); return o; }
static uint32_t u_GetFocus(void) { return focus; }
static uint32_t u_GetActiveWindow(void) { return modal_hwnd ? modal_hwnd : main_hwnd; }
static uint32_t u_SetCapture(void) { uint32_t o = capture; capture = ARG(0); return o; }
static uint32_t u_ReleaseCapture(void) { capture = 0; return 1; }
static uint32_t u_GetCapture(void) { return capture; }
static uint32_t u_SetWindowText(int wide) { wnd_t *w = W(ARG(0)); if (!w) return 0; w32_gstr(ARG(1), wide, w->text, sizeof w->text); invalidate(w, 0, 0, w->cw, w->ch, 1); return 1; }
static uint32_t u_SetWindowTextA(void) { return u_SetWindowText(0); }
static uint32_t u_SetWindowTextW(void) { return u_SetWindowText(1); }
static uint32_t u_GetWindowText(int wide) { wnd_t *w = W(ARG(0)); if (!w) return 0; return w32_pstr(ARG(1), ARG(2), wide, w->text); }
static uint32_t u_GetWindowTextA(void) { return u_GetWindowText(0); }
static uint32_t u_GetWindowTextW(void) { return u_GetWindowText(1); }
static uint32_t win_long(wnd_t *w, int32_t idx, int set, uint32_t val) {
    uint32_t old = 0;
    switch (idx) {
    case -4: old = w->is_dialog ? w->dlgproc : w->proc; if (set) { if (w->is_dialog) w->dlgproc = val; else w->proc = val; } return old; /* GWL_WNDPROC */
    case -21: old = w->user; if (set) w->user = val; return old; /* GWL_USERDATA */
    case -16: old = w->style; if (set) w->style = val; return old; /* GWL_STYLE */
    case -20: old = w->exstyle; if (set) w->exstyle = val; return old;
    case -12: old = w->id; if (set) w->id = val; return old; /* GWL_ID */
    case -6: return w->inst;
    case -8: return w->parent;
    case 0: if (w->is_dialog) { old = w->msgresult; if (set) w->msgresult = val; return old; } /* DWL_MSGRESULT */ /* fallthrough */
    default:
        if (idx >= 0 && idx + 4 <= 128) {
            old = (uint32_t)w->extra[idx] | ((uint32_t)w->extra[idx + 1] << 8) | ((uint32_t)w->extra[idx + 2] << 16) | ((uint32_t)w->extra[idx + 3] << 24);
            if (set) { w->extra[idx] = (uint8_t)val; w->extra[idx + 1] = (uint8_t)(val >> 8); w->extra[idx + 2] = (uint8_t)(val >> 16); w->extra[idx + 3] = (uint8_t)(val >> 24); }
        }
        return old;
    }
}
static uint32_t u_GetWindowLong(void) { wnd_t *w = W(ARG(0)); return w ? win_long(w, (int32_t)ARG(1), 0, 0) : 0; }
static uint32_t u_SetWindowLong(void) { wnd_t *w = W(ARG(0)); return w ? win_long(w, (int32_t)ARG(1), 1, ARG(2)) : 0; }
static uint32_t u_GetClassLong(void) {
    wnd_t *w = W(ARG(0));
    if (!w || w->cls < 0) return 0;
    switch ((int32_t)ARG(1)) { case -10: return classes[w->cls].brush; case -24: return classes[w->cls].proc; case -26: return classes[w->cls].style; default: return 0; }
}
static uint32_t u_SetClassLong(void) {
    wnd_t *w = W(ARG(0));
    if (!w || w->cls < 0) return 0;
    uint32_t old = 0;
    if ((int32_t)ARG(1) == -10) { old = classes[w->cls].brush; classes[w->cls].brush = ARG(2); }
    return old;
}
static uint32_t u_FindWindow(void) { return 0; }
static uint32_t u_IsIconic(void) { return 0; }
static uint32_t u_GetSystemMetrics(void) {
    int32_t sw = w32_gdi_screen_w() ? w32_gdi_screen_w() : 640, sh = w32_gdi_screen_h() ? w32_gdi_screen_h() : 480;
    switch (ARG(0)) {
    case 0: case 16: case 78: return (uint32_t)sw;
    case 1: case 17: case 79: return (uint32_t)sh;
    case 2: case 3: case 9: case 10: case 20: case 21: return 16;
    case 11: case 12: case 13: case 14: return 32;
    case 15: return MENU_H;
    case 36: case 37: return 4;
    case 43: return 2;
    default: return 0; /* caption/border/frame metrics are 0: windows are drawn without frames (INFERRED model) */
    }
}
static uint32_t u_GetSysColor(void) { return w32_sys_color(ARG(0)); }
static uint32_t u_GetSysColorBrush(void) { return ARG(0) + 1; } /* COLOR_x + 1 is accepted wherever a brush is */
static uint32_t u_GetDoubleClickTime(void) { return 500; }
static uint32_t u_LoadCursor(void) { return H_ICON + 1; }
static uint32_t u_LoadIcon(void) { return H_ICON + 2; }
static uint32_t u_SetCursor(void) { return H_ICON + 1; }
static uint32_t u_ShowCursor(void) { cursor_shown += ARG(0) ? 1 : -1; return (uint32_t)cursor_shown; }
static uint32_t u_GetCursorPos(void) { x86_wr32(ARG(0), (uint32_t)imax(last_px, 0)); x86_wr32(ARG(0) + 4, (uint32_t)imax(last_py, 0)); return 1; }
static uint32_t u_LoadImage(int wide) {
    if (ARG(2) == 0) return w32_load_bitmap(ARG(0), ARG(1), wide); /* IMAGE_BITMAP */
    return H_ICON + 3; /* icons/cursors: not drawn */
}
static uint32_t u_LoadImageA(void) { return u_LoadImage(0); }
static uint32_t u_LoadImageW(void) { return u_LoadImage(1); }
static uint32_t u_GetKeyState(void) { uint32_t v = ARG(0) & 0xffu; return keystate[v] & 0x80u ? 0xff80u : 0; }
static uint32_t u_GetAsyncKeyState(void) { uint32_t v = ARG(0) & 0xffu; return keystate[v] & 0x80u ? 0x8000u : 0; }
static uint32_t regmsg_next = 0xc100;
static uint32_t u_RegisterWindowMessage(void) { return regmsg_next++; }
static uint32_t u_MessageBeep(void) { return 1; }
static uint32_t u_LoadString(int wide) {
    char buf[512];
    int32_t n = w32_load_string(ARG(0), ARG(1), buf, sizeof buf);
    if (!ARG(3)) return 0;
    return w32_pstr(ARG(2), ARG(3), wide, n > 0 ? buf : "");
}
static uint32_t u_LoadStringA(void) { return u_LoadString(0); }
static uint32_t u_LoadStringW(void) { return u_LoadString(1); }
static uint32_t u_wsprintfA(void) { return w32_format_to_guest(ARG(0), 1024, 0, ARG(1), X.r[ESP] + 12); }
static uint32_t u_wsprintfW(void) { return w32_format_to_guest(ARG(0), 1024, 1, ARG(1), X.r[ESP] + 12); }
static uint32_t u_wvsprintfA(void) { return w32_format_to_guest(ARG(0), 1024, 0, ARG(1), ARG(2)); }
static uint32_t u_wvsprintfW(void) { return w32_format_to_guest(ARG(0), 1024, 1, ARG(1), ARG(2)); }
static uint32_t u_CharUpper(void) {
    uint32_t p = ARG(0);
    if (p < 0x10000u) { uint32_t c = p & 0xffu; return c >= 'a' && c <= 'z' ? c - 32 : c; }
    return p;
}
static uint32_t u_DrawText(int wide) {
    char s[512];
    uint32_t n = w32_gstrn(ARG(1), (int32_t)ARG(2), wide, s, sizeof s);
    return w32_draw_text(ARG(0), s, (int32_t)n, ARG(3), ARG(4));
}
static uint32_t u_DrawTextA(void) { return u_DrawText(0); }
static uint32_t u_DrawTextW(void) { return u_DrawText(1); }

/* ---- timers */
static uint32_t u_SetTimer(void) {
    uint32_t hwnd = ARG(0), id = ARG(1), ms = ARG(2) ? ARG(2) : 1, proc = ARG(3);
    for (int i = 0; i < NTIMER; i++) if (timers[i].used && timers[i].hwnd == hwnd && hwnd && timers[i].id == id) { timers[i].ms = ms; timers[i].proc = proc; timers[i].due = w32_now_ms() + ms; return id; }
    for (int i = 0; i < NTIMER; i++) {
        if (timers[i].used) continue;
        if (!hwnd) id = 0x7000u + (uint32_t)i;
        timers[i] = (timer_t){1, hwnd, id, ms, proc, w32_now_ms() + ms};
        return id;
    }
    return 0;
}
static uint32_t u_KillTimer(void) {
    for (int i = 0; i < NTIMER; i++) if (timers[i].used && timers[i].hwnd == ARG(0) && timers[i].id == ARG(1)) { timers[i].used = 0; return 1; }
    return 0;
}
void w32_user_fire_timers(void) {
    uint32_t now = w32_now_ms();
    peeks_this_frame = 0;
    for (int i = 0; i < NTIMER; i++) {
        timer_t *t = &timers[i];
        if (!t->used || now < t->due) continue;
        /* WM_TIMER is coalesced: at most one pending per timer */
        int pending = 0;
        for (uint32_t k = qh; k != qt; k = (k + 1) & 511u) if (q[k].msg == 0x0113 && q[k].hwnd == t->hwnd && q[k].wp == t->id) pending = 1;
        if (!pending) { post(t->hwnd, 0x0113, t->id, t->proc); w32_m.timers_fired++; }
        while (t->due <= now) t->due += t->ms;
    }
}

/* ------------------------------------------------------------------ menus */
static uint32_t new_menu(void) {
    for (uint32_t i = 1; i < NMENU; i++) if (!menus[i].used) { __builtin_memset(&menus[i], 0, sizeof menus[i]); menus[i].used = 1; return H_MENU + i; }
    x86_fault("menu table full", 0);
}
static uint32_t parse_menu(uint32_t *p, uint32_t end) {
    uint32_t h = new_menu();
    menu_t *m = M(h);
    while (*p + 2 <= end) {
        uint32_t flags = x86_rd16(*p); *p += 2;
        mitem_t *it = m->n < 32 ? &m->it[m->n++] : &m->it[31];
        it->flags = flags & ~0x80u;
        if (flags & 0x10u) { /* MF_POPUP */
            *p += w32_gstr(*p, 1, it->text, sizeof it->text) * 2 + 2;
            it->sub = parse_menu(p, end);
        } else {
            it->id = x86_rd16(*p); *p += 2;
            *p += w32_gstr(*p, 1, it->text, sizeof it->text) * 2 + 2;
        }
        if (flags & 0x80u) break; /* MF_END */
    }
    return h;
}
static uint32_t load_menu(uint32_t hmod, uint32_t name, int wide) {
    uint32_t sz, d = w32_res_find(hmod, 4, name, wide, &sz);
    if (!d) return 0;
    if (x86_rd16(d) != 0) { w32_m.gdi_unsupported++; return new_menu(); } /* MENUEX templates: not supported in v0.2 */
    uint32_t p = d + 4 + x86_rd16(d + 2);
    return parse_menu(&p, d + sz);
}
static uint32_t u_LoadMenuA(void) { return load_menu(ARG(0), ARG(1), 0); }
static uint32_t u_LoadMenuW(void) { return load_menu(ARG(0), ARG(1), 1); }
static uint32_t u_GetMenu(void) { wnd_t *w = W(ARG(0)); return w ? w->menu : 0; }
static uint32_t u_SetMenu(void) { wnd_t *w = W(ARG(0)); if (!w) return 0; w->menu = ARG(1); if (ARG(0) == main_hwnd) size_main(w); return 1; }
static uint32_t u_GetSubMenu(void) { menu_t *m = M(ARG(0)); return m && ARG(1) < (uint32_t)m->n ? m->it[ARG(1)].sub : 0; }
static mitem_t *find_item(uint32_t hmenu, uint32_t idpos, uint32_t flags) {
    menu_t *m = M(hmenu);
    if (!m) return 0;
    if (flags & 0x400u) return idpos < (uint32_t)m->n ? &m->it[idpos] : 0; /* MF_BYPOSITION */
    for (int i = 0; i < m->n; i++) {
        if (!(m->it[i].flags & 0x10u) && m->it[i].id == idpos) return &m->it[i];
        if (m->it[i].sub) { mitem_t *r = find_item(m->it[i].sub, idpos, flags); if (r) return r; }
    }
    return 0;
}
static uint32_t u_EnableMenuItem(void) {
    mitem_t *it = find_item(ARG(0), ARG(1), ARG(2));
    if (!it) return 0xffffffffu;
    uint32_t old = it->flags & 3u;
    it->flags = (it->flags & ~3u) | (ARG(2) & 3u);
    return old;
}
static uint32_t u_CheckMenuItem(void) {
    mitem_t *it = find_item(ARG(0), ARG(1), ARG(2));
    if (!it) return 0xffffffffu;
    uint32_t old = it->flags & 8u;
    it->flags = (it->flags & ~8u) | (ARG(2) & 8u);
    return old;
}
static uint32_t u_CheckMenuRadioItem(void) {
    for (uint32_t id = ARG(1); id <= ARG(2); id++) { mitem_t *it = find_item(ARG(0), id, ARG(4)); if (it) it->flags = (it->flags & ~8u) | (id == ARG(3) ? 8u : 0); }
    return 1;
}
static uint32_t u_GetMenuState(void) { mitem_t *it = find_item(ARG(0), ARG(1), ARG(2)); return it ? it->flags : 0xffffffffu; }
static uint32_t u_CreateMenu(void) { return new_menu(); }
static uint32_t u_AppendMenu(int wide) {
    menu_t *m = M(ARG(0));
    if (!m || m->n >= 32) return 0;
    mitem_t *it = &m->it[m->n++];
    it->flags = ARG(1);
    if (ARG(1) & 0x10u) it->sub = ARG(2); else it->id = ARG(2);
    if (!(ARG(1) & 0x800u) && ARG(3)) w32_gstr(ARG(3), wide, it->text, sizeof it->text);
    return 1;
}
static uint32_t u_AppendMenuA(void) { return u_AppendMenu(0); }
static uint32_t u_AppendMenuW(void) { return u_AppendMenu(1); }
static uint32_t u_DestroyMenu(void) { menu_t *m = M(ARG(0)); if (m) m->used = 0; return 1; }

/* accelerators */
static uint32_t u_LoadAccelerators(int wide) {
    uint32_t sz, d = w32_res_find(ARG(0), 9, ARG(1), wide, &sz);
    if (!d || naccel_tables >= 8) return 0;
    uint32_t t = naccel_tables++;
    for (uint32_t p = d; p + 8 <= d + sz && naccel[t] < 64; p += 8) {
        accel_t *a = &accels[t][naccel[t]++];
        a->fvirt = (uint8_t)x86_rd16(p); a->key = (uint16_t)x86_rd16(p + 2); a->cmd = (uint16_t)x86_rd16(p + 4);
        if (a->fvirt & 0x80u) break;
    }
    return H_ACCEL + t;
}
static uint32_t u_LoadAcceleratorsA(void) { return u_LoadAccelerators(0); }
static uint32_t u_LoadAcceleratorsW(void) { return u_LoadAccelerators(1); }
static uint32_t u_TranslateAccelerator(void) {
    uint32_t t = ARG(1) - H_ACCEL, p = ARG(2), msg = x86_rd32(p + 4), vk = x86_rd32(p + 8);
    if (t >= naccel_tables || (msg != 0x0100 && msg != 0x0102)) return 0;
    for (uint32_t i = 0; i < naccel[t]; i++) {
        accel_t *a = &accels[t][i];
        int virt = a->fvirt & 1u;
        if (virt != (msg == 0x0100)) continue;
        uint32_t want = virt ? a->key : a->key;
        if (want != vk) continue;
        if (virt) {
            if (!!(a->fvirt & 4u) != !!(keystate[0x10] & 0x80)) continue;
            if (!!(a->fvirt & 8u) != !!(keystate[0x11] & 0x80)) continue;
            if (!!(a->fvirt & 16u) != !!(keystate[0x12] & 0x80)) continue;
        }
        send(ARG(0), 0x0111, 0x10000u | a->cmd, 0);
        return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ menu bar + popup chrome */
static int32_t menu_title_x(menu_t *m, int idx, int32_t *w) {
    int32_t x = 4;
    for (int i = 0; i < m->n; i++) {
        char t[48]; uint32_t k = 0;
        for (const char *c = m->it[i].text; *c && k < 47; c++) if (*c != '&') t[k++] = *c;
        t[k] = 0;
        int32_t tw = g_text_w((int32_t)k, 1) + 12;
        if (i == idx) { *w = tw; return x; }
        x += tw;
    }
    *w = 0;
    return x;
}
static void clean_label(const char *s, char *d, uint32_t cap, char *key) {
    uint32_t k = 0;
    *key = 0;
    for (; *s && k + 1 < cap; s++) {
        if (*s == '\t') { uint32_t j = 0; s++; while (*s && j < 15) key[j++] = *s++; key[j] = 0; break; }
        if (*s != '&') d[k++] = *s;
    }
    d[k] = 0;
}
static void draw_menubar(void) {
    wnd_t *w = W(main_hwnd);
    menu_t *m = w ? M(w->menu) : 0;
    if (!m) return;
    w32_chrome_fill(w->x, w->y, w->w, MENU_H, w32_sys_color(4));
    for (int i = 0; i < m->n; i++) {
        int32_t tw, x = menu_title_x(m, i, &tw);
        char t[48], key[16];
        clean_label(m->it[i].text, t, sizeof t, key);
        if (i == menu_open) w32_chrome_fill(w->x + x, w->y + 1, tw, MENU_H - 2, w32_sys_color(13));
        w32_chrome_text(w->x + x + 6, w->y + 6, t, i == menu_open ? 0xffffff : 0);
    }
}
static void popup_geom(menu_t *pm, int32_t *x, int32_t *y, int32_t *w, int32_t *h) {
    wnd_t *mw = W(main_hwnd);
    menu_t *m = M(mw->menu);
    int32_t tw;
    *x = mw->x + menu_title_x(m, menu_open, &tw);
    *y = mw->y + MENU_H;
    int32_t maxw = 60;
    for (int i = 0; i < pm->n; i++) {
        char t[48], key[16];
        clean_label(pm->it[i].text, t, sizeof t, key);
        maxw = imax(maxw, g_text_w((int32_t)w32_slen(t), 1) + g_text_w((int32_t)w32_slen(key), 1) + 44);
    }
    *w = maxw;
    *h = 4;
    for (int i = 0; i < pm->n; i++) *h += pm->it[i].flags & 0x800u ? 8 : 18;
}
static void draw_popup(void) {
    menu_t *pm = M(menu_open_handle);
    if (!pm) return;
    int32_t x, y, w, h;
    popup_geom(pm, &x, &y, &w, &h);
    w32_chrome_fill(x, y, w, h, 0xffffff);
    w32_chrome_frame(x, y, w, h, w32_sys_color(16));
    int32_t yy = y + 2;
    for (int i = 0; i < pm->n; i++) {
        mitem_t *it = &pm->it[i];
        if (it->flags & 0x800u) { w32_chrome_fill(x + 2, yy + 3, w - 4, 1, w32_sys_color(16)); yy += 8; continue; }
        char t[48], key[16];
        clean_label(it->text, t, sizeof t, key);
        int hot = last_px >= x && last_px < x + w && last_py >= yy && last_py < yy + 18;
        uint32_t col = (it->flags & 3u) ? w32_sys_color(17) : 0;
        if (hot && !(it->flags & 3u)) { w32_chrome_fill(x + 2, yy, w - 4, 18, w32_sys_color(13)); col = 0xffffff; }
        if (it->flags & 8u) w32_chrome_text(x + 6, yy + 6, "v", col);
        w32_chrome_text(x + 20, yy + 6, t, col);
        if (key[0]) w32_chrome_text(x + w - 8 - g_text_w((int32_t)w32_slen(key), 1), yy + 6, key, col);
        yy += 18;
    }
}
static void open_menu(int idx) {
    wnd_t *w = W(main_hwnd);
    menu_t *m = w ? M(w->menu) : 0;
    if (!m || idx < 0 || idx >= m->n) return;
    send(main_hwnd, 0x0116, w->menu, 0);                          /* WM_INITMENU */
    send(main_hwnd, 0x0117, m->it[idx].sub, (uint32_t)idx);       /* WM_INITMENUPOPUP */
    menu_open = idx;
    menu_open_handle = m->it[idx].sub;
}
static void close_menu(void) { menu_open = -1; menu_open_handle = 0; w32_user_invalidate_all(); }
/* returns 1 if the click was consumed by the menu system */
static int menu_click(int32_t px, int32_t py, int down) {
    wnd_t *w = W(main_hwnd);
    menu_t *m = w ? M(w->menu) : 0;
    if (!m) return 0;
    if (menu_open >= 0) {
        menu_t *pm = M(menu_open_handle);
        int32_t x, y, pw, ph;
        if (pm) {
            popup_geom(pm, &x, &y, &pw, &ph);
            if (px >= x && px < x + pw && py >= y && py < y + ph) {
                if (down) return 1;
                int32_t yy = y + 2;
                for (int i = 0; i < pm->n; i++) {
                    int32_t ih = pm->it[i].flags & 0x800u ? 8 : 18;
                    if (py >= yy && py < yy + ih && !(pm->it[i].flags & 0x813u)) {
                        uint32_t id = pm->it[i].id;
                        close_menu();
                        post(main_hwnd, 0x0111, id, 0);
                        return 1;
                    }
                    yy += ih;
                }
                return 1;
            }
        }
    }
    if (py >= w->y && py < w->y + MENU_H && px >= w->x && px < w->x + w->w) {
        if (!down) return 1;
        for (int i = 0; i < m->n; i++) {
            int32_t tw, x = menu_title_x(m, i, &tw);
            if (px >= w->x + x && px < w->x + x + tw) { if (menu_open == i) close_menu(); else { if (menu_open >= 0) close_menu(); open_menu(i); } return 1; }
        }
        if (menu_open >= 0) close_menu();
        return 1;
    }
    if (menu_open >= 0) { if (down) close_menu(); return 1; }
    return 0;
}

/* ------------------------------------------------------------------ MessageBox */
static void mb_layout(void) {
    int32_t sw = w32_gdi_screen_w(), sh = w32_gdi_screen_h();
    mb_w = imax(200, imin(sw - 20, g_text_w((int32_t)w32_slen(mb_text), 1) + 40));
    mb_h = 100;
    mb_x = (sw - mb_w) / 2; mb_y = (sh - mb_h) / 2;
}
static int mb_buttons(uint32_t *ids, const char **labels) {
    switch (mb_type & 0xfu) {
    case 1: ids[0] = 1; labels[0] = "OK"; ids[1] = 2; labels[1] = "Cancel"; return 2;
    case 3: ids[0] = 6; labels[0] = "Yes"; ids[1] = 7; labels[1] = "No"; ids[2] = 2; labels[2] = "Cancel"; return 3;
    case 4: ids[0] = 6; labels[0] = "Yes"; ids[1] = 7; labels[1] = "No"; return 2;
    case 5: ids[0] = 4; labels[0] = "Retry"; ids[1] = 2; labels[1] = "Cancel"; return 2;
    default: ids[0] = 1; labels[0] = "OK"; return 1;
    }
}
static void draw_msgbox(void) {
    w32_chrome_fill(mb_x, mb_y, mb_w, mb_h, w32_sys_color(15));
    w32_chrome_frame(mb_x, mb_y, mb_w, mb_h, w32_sys_color(21));
    w32_chrome_fill(mb_x + 1, mb_y + 1, mb_w - 2, CAPTION_H, w32_sys_color(2));
    w32_chrome_text(mb_x + 6, mb_y + 7, mb_caption, 0xffffff);
    w32_chrome_text(mb_x + 20, mb_y + 36, mb_text, 0);
    uint32_t ids[3]; const char *lab[3];
    int n = mb_buttons(ids, lab);
    for (int i = 0; i < n; i++) {
        int32_t bx = mb_x + mb_w / 2 - n * 40 + i * 80 + 5, by = mb_y + mb_h - 30;
        w32_chrome_fill(bx, by, 70, 22, w32_sys_color(15));
        w32_chrome_frame(bx, by, 70, 22, w32_sys_color(21));
        w32_chrome_text(bx + (70 - g_text_w((int32_t)w32_slen(lab[i]), 1)) / 2, by + 8, lab[i], 0);
    }
}
static void mb_click(int32_t px, int32_t py) {
    uint32_t ids[3]; const char *lab[3];
    int n = mb_buttons(ids, lab);
    for (int i = 0; i < n; i++) {
        int32_t bx = mb_x + mb_w / 2 - n * 40 + i * 80 + 5, by = mb_y + mb_h - 30;
        if (px >= bx && px < bx + 70 && py >= by && py < by + 22) mb_result = (int)ids[i];
    }
}
static uint32_t message_box(int wide) {
    w32_gstr(ARG(1), wide, mb_text, sizeof mb_text);
    if (ARG(2)) w32_gstr(ARG(2), wide, mb_caption, sizeof mb_caption); else { mb_caption[0] = 'E'; mb_caption[1] = 'r'; mb_caption[2] = 'r'; mb_caption[3] = 'o'; mb_caption[4] = 'r'; mb_caption[5] = 0; }
    mb_type = ARG(3);
    if (mb_active) return 1; /* nested message boxes: answer OK */
    mb_layout();
    mb_active = 1; mb_result = 0;
    modal_wait(&mb_result);
    mb_active = 0;
    w32_user_invalidate_all();
    return (uint32_t)mb_result;
}
static uint32_t u_MessageBoxA(void) { return message_box(0); }
static uint32_t u_MessageBoxW(void) { return message_box(1); }

/* ------------------------------------------------------------------ dialogs + controls */
static int32_t du_x(int32_t v) { return v * 6 / 4; }
static int32_t du_y(int32_t v) { return v * 13 / 8; }
/* sz_Or_Ord in a wide template: returns the next position; ordinal in *ord or text into buf */
static uint32_t sz_or_ord(uint32_t p, uint32_t *ord, char *buf, uint32_t cap) {
    uint32_t c = x86_rd16(p);
    if (ord) *ord = 0;
    if (buf && cap) buf[0] = 0;
    if (c == 0) return p + 2;
    if (c == 0xffffu) { if (ord) *ord = x86_rd16(p + 2); return p + 4; }
    uint32_t n = 0;
    while (x86_rd16(p + 2 * n)) n++;
    if (buf) w32_gstrn(p, (int32_t)n, 1, buf, cap);
    return p + 2 * n + 2;
}
static void paint_builtin(wnd_t *w) {
    uint32_t face = w32_sys_color(15), shadow = w32_sys_color(16), dark = w32_sys_color(21), txt = w->enabled ? 0 : w32_sys_color(17);
    int32_t x = w->cx, y = w->cy, cw = w->cw, ch = w->ch;
    uint32_t bs = w->style & 0xfu;
    if (w->builtin == B_BUTTON) {
        if (bs == 0xbu) { /* owner draw: DRAWITEMSTRUCT to the parent */
            static uint32_t dis;
            if (!dis) dis = w32_misc_alloc(48);
            uint32_t hdc = w32_gdi_window_dc(hwnd_of(w), 0, 0, 0, 0, 0);
            x86_wr32(dis, 4); x86_wr32(dis + 4, w->id); x86_wr32(dis + 8, 0); x86_wr32(dis + 12, 1);
            x86_wr32(dis + 16, (w->pressed ? 1u : 0) | (w->enabled ? 0 : 4u) | (focus == hwnd_of(w) ? 0x10u : 0));
            x86_wr32(dis + 20, hwnd_of(w)); x86_wr32(dis + 24, hdc);
            put_rect(dis + 28, 0, 0, cw, ch); x86_wr32(dis + 44, 0);
            send(w->parent, 0x002b, w->id, dis); /* WM_DRAWITEM */
            w32_gdi_release_dc(hdc);
            return;
        }
        if (bs == 7u) { /* group box */
            w32_chrome_frame(x, y + 6, cw, ch - 6, shadow);
            int32_t tw = g_text_w((int32_t)w32_slen(w->text), 1);
            w32_chrome_fill(x + 6, y, tw + 4, 13, face);
            w32_chrome_text(x + 8, y + 3, w->text, txt);
            return;
        }
        if (bs == 2u || bs == 3u || bs == 4u || bs == 9u || bs == 5u || bs == 6u) { /* check box / radio */
            w32_chrome_fill(x, y, cw, ch, face);
            int32_t by = y + (ch - 13) / 2;
            w32_chrome_fill(x, by, 13, 13, 0xffffff);
            w32_chrome_frame(x, by, 13, 13, dark);
            if (w->checked) w32_chrome_fill(x + 3, by + 3, 7, 7, 0);
            w32_chrome_text(x + 18, y + (ch - 7) / 2, w->text, txt);
            return;
        }
        w32_chrome_fill(x, y, cw, ch, face);
        w32_chrome_frame(x, y, cw, ch, w->pressed ? shadow : dark);
        if (bs == 1u) w32_chrome_frame(x + 1, y + 1, cw - 2, ch - 2, dark);
        char t[128], k[16];
        clean_label(w->text, t, sizeof t, k);
        w32_chrome_text(x + (cw - g_text_w((int32_t)w32_slen(t), 1)) / 2, y + (ch - 7) / 2, t, txt);
        return;
    }
    if (w->builtin == B_STATIC) {
        uint32_t ss = w->style & 0x1fu;
        if (ss == 3u || ss == 0xeu) return; /* icon / bitmap: not drawn */
        if (ss >= 4u && ss <= 9u) { w32_chrome_frame(x, y, cw, ch, ss & 1u ? shadow : dark); return; }
        w32_chrome_fill(x, y, cw, ch, face);
        char t[128], k[16];
        clean_label(w->text, t, sizeof t, k);
        int32_t tw = g_text_w((int32_t)w32_slen(t), 1), tx = x;
        if (ss == 1u) tx = x + (cw - tw) / 2; else if (ss == 2u) tx = x + cw - tw;
        w32_chrome_text(tx, y + 2, t, txt);
        return;
    }
    if (w->builtin == B_EDIT) {
        w32_chrome_fill(x, y, cw, ch, 0xffffff);
        w32_chrome_frame(x, y, cw, ch, shadow);
        w32_chrome_text(x + 3, y + (ch - 7) / 2, w->text, txt);
        return;
    }
    w32_chrome_fill(x, y, cw, ch, 0xffffff);
    w32_chrome_frame(x, y, cw, ch, shadow);
}
static void notify_parent(wnd_t *w, uint32_t code) { send(w->parent, 0x0111, (code << 16) | (w->id & 0xffffu), hwnd_of(w)); }
static uint32_t builtin_proc(wnd_t *w, uint32_t msg, uint32_t wp, uint32_t lp) {
    uint32_t bs = w->style & 0xfu;
    switch (msg) {
    case 0x000f: { w->inval = 0; w->erase = 0; paint_builtin(w); return 0; }
    case 0x00f0: return (uint32_t)w->checked;                                          /* BM_GETCHECK */
    case 0x00f1: w->checked = (int)wp; invalidate(w, 0, 0, w->cw, w->ch, 1); return 0; /* BM_SETCHECK */
    case 0x000c: w32_gstr(lp, 1, w->text, sizeof w->text); invalidate(w, 0, 0, w->cw, w->ch, 1); return 1;
    case 0x000d: return w32_pstr(lp, wp, 1, w->text);
    case 0x000e: return w32_slen(w->text);
    case 0x0201: if (w->builtin == B_BUTTON && w->enabled) { w->pressed = 1; capture = hwnd_of(w); invalidate(w, 0, 0, w->cw, w->ch, 1); } return 0;
    case 0x0202:
        if (w->builtin == B_BUTTON && w->pressed) {
            w->pressed = 0;
            capture = 0;
            invalidate(w, 0, 0, w->cw, w->ch, 1);
            int32_t x = (int16_t)(lp & 0xffff), y = (int16_t)(lp >> 16);
            if (x < 0 || y < 0 || x >= w->cw || y >= w->ch) return 0;
            if (bs == 3u || bs == 6u) w->checked = !w->checked;
            if (bs == 9u) { /* auto radio: uncheck siblings in the group */
                for (int i = 1; i < NWND; i++) if (wnds[i].used && wnds[i].parent == w->parent && wnds[i].builtin == B_BUTTON && (wnds[i].style & 0xfu) == 9u) { wnds[i].checked = 0; invalidate(&wnds[i], 0, 0, wnds[i].cw, wnds[i].ch, 1); }
                w->checked = 1;
            }
            notify_parent(w, 0); /* BN_CLICKED */
        }
        return 0;
    case 0x0102: /* WM_CHAR into an edit control */
        if (w->builtin == B_EDIT) {
            uint32_t n = w32_slen(w->text);
            if (wp == 8 && n) w->text[n - 1] = 0;
            else if (wp >= 32 && wp < 127 && n < 126) { w->text[n] = (char)wp; w->text[n + 1] = 0; }
            invalidate(w, 0, 0, w->cw, w->ch, 1);
            notify_parent(w, 0x300); /* EN_CHANGE */
        }
        return 0;
    default: return 0;
    }
}
static uint32_t dialog_default(wnd_t *w, uint32_t msg, uint32_t wp, uint32_t lp) {
    (void)lp;
    switch (msg) {
    case 0x000f: { /* paint dialog face (the frame/caption are drawn as part of the window) */
        uint32_t h = hwnd_of(w);
        w->inval = 0; w->erase = 0;
        w32_chrome_fill(w->x, w->y, w->w, w->h, w32_sys_color(15));
        w32_chrome_frame(w->x, w->y, w->w, w->h, w32_sys_color(21));
        w32_chrome_fill(w->x + 2, w->y + 2, w->w - 4, CAPTION_H - 2, w32_sys_color(2));
        w32_chrome_text(w->x + 8, w->y + 7, w->text, 0xffffff);
        for (int i = 1; i < NWND; i++) if (wnds[i].used && !wnds[i].destroyed && wnds[i].parent == h) invalidate(&wnds[i], 0, 0, wnds[i].cw, wnds[i].ch, 1);
        return 0;
    }
    case 0x0010: send(hwnd_of(w), 0x0111, 2, 0); return 0; /* WM_CLOSE -> IDCANCEL */
    case 0x0111: if ((wp & 0xffffu) == 1 || (wp & 0xffffu) == 2) { w->dlg_ended = 1; w->dlg_result = wp & 0xffffu; } return 0;
    default: return 0;
    }
}
static uint32_t create_dialog(uint32_t hinst, uint32_t tpl, uint32_t owner, uint32_t proc, uint32_t lparam) {
    uint32_t p = tpl, style, cdit, ex = x86_rd16(tpl + 2) == 0xffffu;
    int32_t x, y, cx, cy;
    char title[128], cls[48];
    if (ex) { style = x86_rd32(tpl + 12); cdit = x86_rd16(tpl + 16); x = (int16_t)x86_rd16(tpl + 18); y = (int16_t)x86_rd16(tpl + 20); cx = (int16_t)x86_rd16(tpl + 22); cy = (int16_t)x86_rd16(tpl + 24); p = tpl + 26; }
    else { style = x86_rd32(tpl); cdit = x86_rd16(tpl + 8); x = (int16_t)x86_rd16(tpl + 10); y = (int16_t)x86_rd16(tpl + 12); cx = (int16_t)x86_rd16(tpl + 14); cy = (int16_t)x86_rd16(tpl + 16); p = tpl + 18; }
    p = sz_or_ord(p, 0, 0, 0);               /* menu */
    p = sz_or_ord(p, 0, cls, sizeof cls);    /* class */
    p = sz_or_ord(p, 0, title, sizeof title);
    if (style & 0x40u) { p += ex ? 6 : 2; p = sz_or_ord(p, 0, 0, 0); } /* DS_SETFONT: size [, weight, italic, charset], face */
    int32_t w = du_x(cx) + 4, h = du_y(cy) + CAPTION_H + 4;
    wnd_t *ow = W(owner);
    int32_t ox = ow ? ow->x : 0, oy = ow ? ow->y : 0, oww = ow ? ow->w : w32_gdi_screen_w(), owh = ow ? ow->h : w32_gdi_screen_h();
    int32_t px = (style & 0x800u) || !ow ? ox + (oww - w) / 2 : ox + du_x(x), py = (style & 0x800u) || !ow ? oy + (owh - h) / 2 : oy + du_y(y);
    px = imax(0, imin(px, w32_gdi_screen_w() - w)); py = imax(0, imin(py, w32_gdi_screen_h() - h));
    uint32_t hd = new_window(0, -1, B_NONE, title, style & ~0x40000000u, px, py, w, h, owner, 0, hinst);
    wnd_t *d = W(hd);
    d->is_dialog = 1; d->dlgproc = proc; d->visible = 1;
    recalc_client(d, hd);
    for (uint32_t i = 0; i < cdit; i++) {
        p = (p + 3u) & ~3u;
        uint32_t ist, iid;
        int32_t ix, iy, icx, icy;
        if (ex) { ist = x86_rd32(p + 8); ix = (int16_t)x86_rd16(p + 12); iy = (int16_t)x86_rd16(p + 14); icx = (int16_t)x86_rd16(p + 16); icy = (int16_t)x86_rd16(p + 18); iid = x86_rd32(p + 20); p += 24; }
        else { ist = x86_rd32(p); ix = (int16_t)x86_rd16(p + 8); iy = (int16_t)x86_rd16(p + 10); icx = (int16_t)x86_rd16(p + 12); icy = (int16_t)x86_rd16(p + 14); iid = x86_rd16(p + 16); p += 18; }
        uint32_t cord;
        char ccls[48], ctext[128];
        p = sz_or_ord(p, &cord, ccls, sizeof ccls);
        p = sz_or_ord(p, 0, ctext, sizeof ctext);
        uint32_t extra = x86_rd16(p);
        p += 2 + extra;
        int kind = cord == 0x80 ? B_BUTTON : cord == 0x81 ? B_EDIT : cord == 0x82 ? B_STATIC : cord ? B_OTHER : builtin_kind(ccls);
        int gcls = -1;
        if (!kind) { /* custom (guest-registered) control class */
            for (int c = 0; c < NCLASS; c++) if (classes[c].used && w32_streqi(classes[c].name, ccls)) gcls = c;
            if (gcls < 0) kind = B_OTHER;
        }
        uint32_t hc = new_window(0, gcls, kind, ctext, ist | 0x40000000u, du_x(ix), du_y(iy), du_x(icx), du_y(icy), hd, iid, hinst);
        wnd_t *c = W(hc);
        c->visible = (ist & 0x10000000u) != 0;
        if (!kind) send(hc, 0x0001, 0, 0);
    }
    focus = hd;
    invalidate(d, 0, 0, d->cw, d->ch, 1);
    send(hd, 0x0110, 0, lparam); /* WM_INITDIALOG */
    return hd;
}
static uint32_t dialog_box(int wide) {
    uint32_t hinst = ARG(0), sz, tpl = w32_res_find(hinst, 5, ARG(1), wide, &sz);
    if (!tpl) return 0xffffffffu;
    uint32_t prev_modal = modal_hwnd;
    uint32_t hd = create_dialog(hinst, tpl, ARG(2) ? ARG(2) : main_hwnd, ARG(3), ARG(4));
    modal_hwnd = hd;
    wnd_t *d = W(hd);
    modal_wait(&d->dlg_ended);
    uint32_t r = d->dlg_result;
    modal_hwnd = prev_modal;
    destroy(hd);
    focus = main_hwnd;
    return r;
}
static uint32_t u_DialogBoxParamA(void) { return dialog_box(0); }
static uint32_t u_DialogBoxParamW(void) { return dialog_box(1); }
static uint32_t u_CreateDialogParam(int wide) {
    uint32_t sz, tpl = w32_res_find(ARG(0), 5, ARG(1), wide, &sz);
    return tpl ? create_dialog(ARG(0), tpl, ARG(2), ARG(3), ARG(4)) : 0;
}
static uint32_t u_CreateDialogParamA(void) { return u_CreateDialogParam(0); }
static uint32_t u_CreateDialogParamW(void) { return u_CreateDialogParam(1); }
static uint32_t u_EndDialog(void) { wnd_t *d = W(ARG(0)); if (!d) return 0; d->dlg_ended = 1; d->dlg_result = ARG(1); return 1; }
static uint32_t u_GetDlgItem(void) {
    for (int i = 1; i < NWND; i++) if (wnds[i].used && !wnds[i].destroyed && wnds[i].parent == ARG(0) && wnds[i].id == ARG(1)) return H_WND + (uint32_t)i;
    return 0;
}
static uint32_t u_GetDlgCtrlID(void) { wnd_t *w = W(ARG(0)); return w ? w->id : 0; }
static wnd_t *dlg_item(uint32_t hd, uint32_t id) {
    for (int i = 1; i < NWND; i++) if (wnds[i].used && !wnds[i].destroyed && wnds[i].parent == hd && wnds[i].id == id) return &wnds[i];
    return 0;
}
static uint32_t u_CheckDlgButton(void) { wnd_t *c = dlg_item(ARG(0), ARG(1)); if (!c) return 0; c->checked = (int)ARG(2); invalidate(c, 0, 0, c->cw, c->ch, 1); return 1; }
static uint32_t u_IsDlgButtonChecked(void) { wnd_t *c = dlg_item(ARG(0), ARG(1)); return c ? (uint32_t)c->checked : 0; }
static uint32_t u_CheckRadioButton(void) {
    for (uint32_t id = ARG(1); id <= ARG(2); id++) { wnd_t *c = dlg_item(ARG(0), id); if (c) { c->checked = id == ARG(3); invalidate(c, 0, 0, c->cw, c->ch, 1); } }
    return 1;
}
static uint32_t u_SetDlgItemText(int wide) { wnd_t *c = dlg_item(ARG(0), ARG(1)); if (!c) return 0; w32_gstr(ARG(2), wide, c->text, sizeof c->text); invalidate(c, 0, 0, c->cw, c->ch, 1); return 1; }
static uint32_t u_SetDlgItemTextA(void) { return u_SetDlgItemText(0); }
static uint32_t u_SetDlgItemTextW(void) { return u_SetDlgItemText(1); }
static uint32_t u_GetDlgItemText(int wide) { wnd_t *c = dlg_item(ARG(0), ARG(1)); return c ? w32_pstr(ARG(2), ARG(3), wide, c->text) : 0; }
static uint32_t u_GetDlgItemTextA(void) { return u_GetDlgItemText(0); }
static uint32_t u_GetDlgItemTextW(void) { return u_GetDlgItemText(1); }
static uint32_t u_SetDlgItemInt(void) {
    wnd_t *c = dlg_item(ARG(0), ARG(1));
    if (!c) return 0;
    int32_t v = (int32_t)ARG(2);
    char t[16]; int n = 0; uint32_t u = ARG(3) && v < 0 ? (uint32_t)(-v) : (uint32_t)v;
    do { t[n++] = (char)('0' + u % 10); u /= 10; } while (u);
    uint32_t k = 0;
    if (ARG(3) && v < 0) c->text[k++] = '-';
    while (n) c->text[k++] = t[--n];
    c->text[k] = 0;
    invalidate(c, 0, 0, c->cw, c->ch, 1);
    return 1;
}
static uint32_t u_GetDlgItemInt(void) {
    wnd_t *c = dlg_item(ARG(0), ARG(1));
    int32_t v = 0;
    int neg = 0, ok = 0;
    if (c) { const char *s = c->text; if (*s == '-') { neg = 1; s++; } while (*s >= '0' && *s <= '9') { v = v * 10 + (*s++ - '0'); ok = 1; } }
    if (ARG(2)) x86_wr32(ARG(2), (uint32_t)ok);
    return (uint32_t)(neg ? -v : v);
}
static uint32_t u_SendDlgItemMessage(void) { wnd_t *c = dlg_item(ARG(0), ARG(1)); return c ? send(hwnd_of(c), ARG(2), ARG(3), ARG(4)) : 0; }

/* ------------------------------------------------------------------ rect helpers */
#define RD(p, i) ((int32_t)x86_rd32((p) + 4u * (i)))
static uint32_t u_SetRect(void) { put_rect(ARG(0), (int32_t)ARG(1), (int32_t)ARG(2), (int32_t)ARG(3), (int32_t)ARG(4)); return 1; }
static uint32_t u_SetRectEmpty(void) { put_rect(ARG(0), 0, 0, 0, 0); return 1; }
static uint32_t u_CopyRect(void) { put_rect(ARG(0), RD(ARG(1), 0), RD(ARG(1), 1), RD(ARG(1), 2), RD(ARG(1), 3)); return 1; }
static uint32_t u_InflateRect(void) { uint32_t r = ARG(0); int32_t dx = (int32_t)ARG(1), dy = (int32_t)ARG(2); put_rect(r, RD(r, 0) - dx, RD(r, 1) - dy, RD(r, 2) + dx, RD(r, 3) + dy); return 1; }
static uint32_t u_OffsetRect(void) { uint32_t r = ARG(0); int32_t dx = (int32_t)ARG(1), dy = (int32_t)ARG(2); put_rect(r, RD(r, 0) + dx, RD(r, 1) + dy, RD(r, 2) + dx, RD(r, 3) + dy); return 1; }
static uint32_t u_IntersectRect(void) {
    uint32_t a = ARG(1), b = ARG(2);
    int32_t l = imax(RD(a, 0), RD(b, 0)), t = imax(RD(a, 1), RD(b, 1)), r = imin(RD(a, 2), RD(b, 2)), bt = imin(RD(a, 3), RD(b, 3));
    if (r <= l || bt <= t) { put_rect(ARG(0), 0, 0, 0, 0); return 0; }
    put_rect(ARG(0), l, t, r, bt);
    return 1;
}
static uint32_t u_UnionRect(void) {
    uint32_t a = ARG(1), b = ARG(2);
    put_rect(ARG(0), imin(RD(a, 0), RD(b, 0)), imin(RD(a, 1), RD(b, 1)), imax(RD(a, 2), RD(b, 2)), imax(RD(a, 3), RD(b, 3)));
    return 1;
}
static uint32_t u_PtInRect(void) { uint32_t r = ARG(0); int32_t x = (int32_t)ARG(1), y = (int32_t)ARG(2); return x >= RD(r, 0) && x < RD(r, 2) && y >= RD(r, 1) && y < RD(r, 3); }
static uint32_t u_IsRectEmpty(void) { uint32_t r = ARG(0); return RD(r, 2) <= RD(r, 0) || RD(r, 3) <= RD(r, 1); }
static uint32_t u_EqualRect(void) { for (uint32_t i = 0; i < 4; i++) if (RD(ARG(0), i) != RD(ARG(1), i)) return 0; return 1; }

/* ------------------------------------------------------------------ input pump */
static uint32_t hid_to_vk(uint32_t hid) {
    if (hid >= 4 && hid <= 29) return 'A' + hid - 4;
    if (hid >= 30 && hid <= 38) return '1' + hid - 30;
    if (hid == 39) return '0';
    if (hid >= 58 && hid <= 69) return 0x70 + hid - 58;
    switch (hid) {
    case 40: return 0x0d; case 41: return 0x1b; case 42: return 0x08; case 43: return 0x09; case 44: return 0x20;
    case 79: return 0x27; case 80: return 0x25; case 81: return 0x28; case 82: return 0x26;
    case 73: return 0x2d; case 74: return 0x24; case 75: return 0x21; case 76: return 0x2e; case 77: return 0x23; case 78: return 0x22;
    case 224: case 228: return 0x11; case 225: case 229: return 0x10; case 226: case 230: return 0x12;
    default: return 0;
    }
}
static wnd_t *hit(int32_t x, int32_t y) {
    for (int i = NWND - 1; i > 0; i--) {
        wnd_t *w = &wnds[i];
        if (!w->used || w->destroyed || !w->visible || !w->enabled) continue;
        if (x < w->cx || y < w->cy || x >= w->cx + w->cw || y >= w->cy + w->ch) continue;
        if (modal_hwnd) { /* only the modal dialog and its controls get input */
            uint32_t h = hwnd_of(w);
            if (h != modal_hwnd && w->parent != modal_hwnd) continue;
        }
        return w;
    }
    return 0;
}
static uint32_t mk_flags(uint32_t buttons) {
    return ((buttons & 1u) ? 1u : 0) | ((buttons & 2u) ? 2u : 0) | ((buttons & 4u) ? 0x10u : 0) |
           ((keystate[0x10] & 0x80) ? 4u : 0) | ((keystate[0x11] & 0x80) ? 8u : 0);
}
static void mouse_msg(uint32_t msg, int32_t px, int32_t py, uint32_t buttons) {
    wnd_t *w = capture ? W(capture) : hit(px, py);
    if (!w) return;
    uint32_t lp = ((uint32_t)(uint16_t)(py - w->cy) << 16) | (uint16_t)(px - w->cx);
    if (msg == 0x0201 || msg == 0x0204) focus = w->builtin || w->is_dialog ? focus : hwnd_of(w);
    if (msg == 0x0201 && w->cls >= 0 && (classes[w->cls].style & 8u)) { /* CS_DBLCLKS */
        uint32_t now = w32_now_ms();
        int32_t dx = px - last_click_x, dy = py - last_click_y;
        if (last_click_hwnd == hwnd_of(w) && now - last_click_time <= 500 && dx * dx + dy * dy <= 16) { msg = 0x0203; last_click_time = 0; }
        else { last_click_time = now; last_click_hwnd = hwnd_of(w); last_click_x = px; last_click_y = py; }
    }
    post(hwnd_of(w), msg, mk_flags(buttons), lp);
}
void w32_user_pump_input(void) {
    bgt_io_t *io = w32_io;
    int32_t px = io->pointer_x, py = io->pointer_y;
    uint32_t b = io->pointer_buttons;
    /* keyboard */
    for (uint32_t k = 0; k < 256; k++) {
        uint32_t now = (io->keys[k >> 5] >> (k & 31)) & 1u, was = (prev_keys[k >> 5] >> (k & 31)) & 1u, pressed = (io->keys_pressed[k >> 5] >> (k & 31)) & 1u;
        uint32_t vk = hid_to_vk(k);
        if (!vk) continue;
        if ((now && !was) || (pressed && !was)) {
            keystate[vk] |= 0x80;
            if (mb_active) { if (vk == 0x0d) mb_result = (mb_type & 0xfu) == 4 || (mb_type & 0xfu) == 3 ? 6 : 1; else if (vk == 0x1b) mb_result = (mb_type & 0xfu) == 4 ? 7 : 2; continue; }
            if (modal_hwnd && (vk == 0x0d || vk == 0x1b)) { send(modal_hwnd, 0x0111, vk == 0x0d ? 1 : 2, 0); continue; }
            post(focus ? focus : main_hwnd, 0x0100, vk, 1);
        }
        if (!now && (was || pressed)) { keystate[vk] &= 0x7f; if (!mb_active) post(focus ? focus : main_hwnd, 0x0101, vk, 0xc0000001u); }
    }
    for (int i = 0; i < 8; i++) prev_keys[i] = io->keys[i];
    /* mouse */
    int moved = px != last_px || py != last_py;
    uint32_t down = b & ~last_pbuttons, up = last_pbuttons & ~b;
    last_px = px; last_py = py;
    if (mb_active) { if (up & 1u) mb_click(px, py); last_pbuttons = b; return; }
    if ((down & 1u) && menu_click(px, py, 1)) { last_pbuttons = b; return; }
    if ((up & 1u) && menu_open >= 0 && menu_click(px, py, 0)) { last_pbuttons = b; return; }
    if (menu_open >= 0) { last_pbuttons = b; return; }
    if (moved && io->pointer_inside) mouse_msg(0x0200, px, py, b);
    if (down & 1u) mouse_msg(0x0201, px, py, b);
    if (up & 1u) mouse_msg(0x0202, px, py, b);
    if (down & 2u) mouse_msg(0x0204, px, py, b);
    if (up & 2u) mouse_msg(0x0205, px, py, b);
    last_pbuttons = b;
}

/* ------------------------------------------------------------------ read-only layout for tests (debugState().ui) */
static const char *class_name(wnd_t *w) {
    if (w->builtin == B_BUTTON) return "button";
    if (w->builtin == B_STATIC) return "static";
    if (w->builtin == B_EDIT) return "edit";
    if (w->builtin == B_OTHER) return "other";
    if (w->is_dialog) return "#32770";
    return w->cls > 0 ? classes[w->cls].name : "";
}
static void debug_items(w32_json_t *j, menu_t *m, int32_t x, int32_t y, int32_t w, int popup) {
    int32_t yy = y + 2;
    for (int i = 0; i < m->n; i++) {
        mitem_t *it = &m->it[i];
        if (i) wj_raw(j, ",");
        wj_raw(j, "{\"pos\":"); wj_int(j, i);
        wj_raw(j, ",\"text\":"); wj_str(j, it->text);
        wj_raw(j, ",\"id\":"); wj_int(j, (it->flags & 0x10u) ? -1 : (int64_t)it->id);
        wj_raw(j, ",\"flags\":"); wj_int(j, it->flags);
        /* Win32 meaning: MF_SEPARATOR, or a resource MENUITEM SEPARATOR (flags 0, id 0, empty text) */
        int sep = (it->flags & 0x800u) || (!(it->flags & 0x10u) && !it->id && !it->text[0]);
        wj_raw(j, sep ? ",\"separator\":true" : ",\"separator\":false");
        wj_raw(j, (it->flags & 3u) ? ",\"disabled\":true" : ",\"disabled\":false");
        wj_raw(j, (it->flags & 8u) ? ",\"checked\":true" : ",\"checked\":false");
        wj_raw(j, (it->flags & 0x10u) ? ",\"popup\":true" : ",\"popup\":false");
        wj_raw(j, ",\"rect\":");
        if (popup) { int32_t ih = it->flags & 0x800u ? 8 : 18; wj_rect(j, x, yy, w, ih); yy += ih; }
        else { int32_t tw, tx = menu_title_x(m, i, &tw); wj_rect(j, x + tx, y, tw, MENU_H); }
        wj_raw(j, "}");
    }
}
void w32_user_debug_ui(w32_json_t *j) {
    wnd_t *mw = W(main_hwnd);
    menu_t *m = mw ? M(mw->menu) : 0;
    wj_raw(j, "{\"main\":"); wj_int(j, main_hwnd);
    wj_raw(j, ",\"modal\":"); wj_int(j, modal_hwnd);
    wj_raw(j, ",\"focus\":"); wj_int(j, focus);
    wj_raw(j, ",\"capture\":"); wj_int(j, capture);
    wj_raw(j, ",\"menubar\":");
    if (m) {
        wj_raw(j, "{\"rect\":"); wj_rect(j, mw->x, mw->y, mw->w, MENU_H);
        wj_raw(j, ",\"open\":"); wj_int(j, menu_open);
        wj_raw(j, ",\"items\":["); debug_items(j, m, mw->x, mw->y, 0, 0); wj_raw(j, "]}");
    } else wj_raw(j, "null");
    wj_raw(j, ",\"popup\":");
    menu_t *pm = menu_open >= 0 ? M(menu_open_handle) : 0;
    if (pm && m) {
        int32_t x, y, w, h;
        popup_geom(pm, &x, &y, &w, &h);
        wj_raw(j, "{\"menu\":"); wj_int(j, menu_open);
        wj_raw(j, ",\"rect\":"); wj_rect(j, x, y, w, h);
        wj_raw(j, ",\"items\":["); debug_items(j, pm, x, y, w, 1); wj_raw(j, "]}");
    } else wj_raw(j, "null");
    wj_raw(j, ",\"messagebox\":");
    if (mb_active) {
        uint32_t ids[3]; const char *lab[3];
        int n = mb_buttons(ids, lab);
        wj_raw(j, "{\"caption\":"); wj_str(j, mb_caption);
        wj_raw(j, ",\"text\":"); wj_str(j, mb_text);
        wj_raw(j, ",\"type\":"); wj_int(j, mb_type);
        wj_raw(j, ",\"rect\":"); wj_rect(j, mb_x, mb_y, mb_w, mb_h);
        wj_raw(j, ",\"buttons\":[");
        for (int i = 0; i < n; i++) {
            if (i) wj_raw(j, ",");
            wj_raw(j, "{\"id\":"); wj_int(j, ids[i]);
            wj_raw(j, ",\"text\":"); wj_str(j, lab[i]);
            wj_raw(j, ",\"rect\":"); wj_rect(j, mb_x + mb_w / 2 - n * 40 + i * 80 + 5, mb_y + mb_h - 30, 70, 22);
            wj_raw(j, "}");
        }
        wj_raw(j, "]}");
    } else wj_raw(j, "null");
    wj_raw(j, ",\"windows\":[");
    int first = 1;
    for (int i = 1; i < NWND; i++) {
        wnd_t *w = &wnds[i];
        if (!w->used || w->destroyed || !w->visible) continue;
        if (!first) wj_raw(j, ",");
        first = 0;
        wj_raw(j, "{\"hwnd\":"); wj_int(j, hwnd_of(w));
        wj_raw(j, ",\"parent\":"); wj_int(j, w->parent);
        wj_raw(j, ",\"class\":"); wj_str(j, class_name(w));
        wj_raw(j, ",\"text\":"); wj_str(j, w->text);
        wj_raw(j, ",\"id\":"); wj_int(j, (w->style & 0x40000000u) ? (int64_t)w->id : 0);
        wj_raw(j, ",\"style\":"); wj_int(j, w->style);
        wj_raw(j, w->is_dialog ? ",\"dialog\":true" : ",\"dialog\":false");
        wj_raw(j, w->enabled ? ",\"enabled\":true" : ",\"enabled\":false");
        wj_raw(j, ",\"checked\":"); wj_int(j, w->checked);
        wj_raw(j, ",\"rect\":"); wj_rect(j, w->x, w->y, w->w, w->h);
        wj_raw(j, ",\"client\":"); wj_rect(j, w->cx, w->cy, w->cw, w->ch);
        wj_raw(j, "}");
    }
    wj_raw(j, "]}");
}

void w32_user_present_overlay(void) {
    draw_menubar();
    if (menu_open >= 0) draw_popup();
    if (mb_active) draw_msgbox();
}

void w32_user_init(void) {
    menus = (menu_t *)x86_alloc(NMENU * sizeof(menu_t));
    if (!menus) x86_fault("out of memory (menus)", 0);
    classes[0].used = 1; /* index 0 reserved */
}

#define API(n, a, f) {n, a, 0, f}
#define CAPI(n, f) {n, 0, 1, f}
#define STUB(n, a) {n, a, 0, 0}
const w32_api_t w32_api_user[] = {
    API("RegisterClassA", 1, u_RegisterClassA), API("RegisterClassW", 1, u_RegisterClassW),
    API("RegisterClassExA", 1, u_RegisterClassExA), API("RegisterClassExW", 1, u_RegisterClassExW),
    API("CreateWindowExA", 12, u_CreateWindowExA), API("CreateWindowExW", 12, u_CreateWindowExW),
    API("DestroyWindow", 1, u_DestroyWindow), API("ShowWindow", 2, u_ShowWindow), API("UpdateWindow", 1, u_UpdateWindow),
    API("MoveWindow", 6, u_MoveWindow), API("SetWindowPos", 7, u_SetWindowPos),
    API("GetClientRect", 2, u_GetClientRect), API("GetWindowRect", 2, u_GetWindowRect),
    API("ClientToScreen", 2, u_ClientToScreen), API("ScreenToClient", 2, u_ScreenToClient),
    API("AdjustWindowRect", 3, u_AdjustWindowRect), API("AdjustWindowRectEx", 4, u_AdjustWindowRectEx),
    API("GetDesktopWindow", 0, u_GetDesktopWindow), API("IsWindow", 1, u_IsWindow), API("IsWindowVisible", 1, u_IsWindowVisible),
    API("IsWindowEnabled", 1, u_IsWindowEnabled), API("EnableWindow", 2, u_EnableWindow), API("IsIconic", 1, u_IsIconic), API("IsZoomed", 1, u_IsIconic),
    API("GetParent", 1, u_GetParent), API("SetFocus", 1, u_SetFocus), API("GetFocus", 0, u_GetFocus), API("GetActiveWindow", 0, u_GetActiveWindow),
    API("SetActiveWindow", 1, u_GetActiveWindow), API("SetForegroundWindow", 1, u_one), API("GetForegroundWindow", 0, u_GetActiveWindow),
    API("SetCapture", 1, u_SetCapture), API("ReleaseCapture", 0, u_ReleaseCapture), API("GetCapture", 0, u_GetCapture),
    API("SetWindowTextA", 2, u_SetWindowTextA), API("SetWindowTextW", 2, u_SetWindowTextW),
    API("GetWindowTextA", 3, u_GetWindowTextA), API("GetWindowTextW", 3, u_GetWindowTextW),
    API("GetWindowLongA", 2, u_GetWindowLong), API("GetWindowLongW", 2, u_GetWindowLong),
    API("SetWindowLongA", 3, u_SetWindowLong), API("SetWindowLongW", 3, u_SetWindowLong),
    API("GetClassLongA", 2, u_GetClassLong), API("GetClassLongW", 2, u_GetClassLong),
    API("SetClassLongA", 3, u_SetClassLong), API("SetClassLongW", 3, u_SetClassLong),
    API("FindWindowA", 2, u_FindWindow), API("FindWindowW", 2, u_FindWindow),
    API("GetMessageA", 4, u_GetMessage), API("GetMessageW", 4, u_GetMessage),
    API("PeekMessageA", 5, u_PeekMessage), API("PeekMessageW", 5, u_PeekMessage),
    API("WaitMessage", 0, u_WaitMessage), API("MsgWaitForMultipleObjects", 5, u_MsgWaitForMultipleObjects),
    API("TranslateMessage", 1, u_TranslateMessage), API("DispatchMessageA", 1, u_DispatchMessage), API("DispatchMessageW", 1, u_DispatchMessage),
    API("SendMessageA", 4, u_SendMessage), API("SendMessageW", 4, u_SendMessage),
    API("PostMessageA", 4, u_PostMessage), API("PostMessageW", 4, u_PostMessage), API("PostQuitMessage", 1, u_PostQuitMessage),
    API("CallWindowProcA", 5, u_CallWindowProc), API("CallWindowProcW", 5, u_CallWindowProc),
    API("DefWindowProcA", 4, u_DefWindowProc), API("DefWindowProcW", 4, u_DefWindowProc),
    API("BeginPaint", 2, u_BeginPaint), API("EndPaint", 2, u_EndPaint), API("GetDC", 1, u_GetDC), API("GetWindowDC", 1, u_GetDC), API("ReleaseDC", 2, u_ReleaseDC),
    API("InvalidateRect", 3, u_InvalidateRect), API("ValidateRect", 2, u_ValidateRect), API("GetUpdateRect", 3, u_GetUpdateRect),
    API("RedrawWindow", 4, u_RedrawWindow),
    API("SetTimer", 4, u_SetTimer), API("KillTimer", 2, u_KillTimer),
    API("GetSystemMetrics", 1, u_GetSystemMetrics), API("GetSysColor", 1, u_GetSysColor), API("GetSysColorBrush", 1, u_GetSysColorBrush),
    API("GetDoubleClickTime", 0, u_GetDoubleClickTime), API("SystemParametersInfoA", 4, u_zero), API("SystemParametersInfoW", 4, u_zero),
    API("LoadCursorA", 2, u_LoadCursor), API("LoadCursorW", 2, u_LoadCursor), API("LoadIconA", 2, u_LoadIcon), API("LoadIconW", 2, u_LoadIcon),
    API("LoadImageA", 6, u_LoadImageA), API("LoadImageW", 6, u_LoadImageW),
    API("SetCursor", 1, u_SetCursor), API("ShowCursor", 1, u_ShowCursor), API("GetCursorPos", 1, u_GetCursorPos), API("SetCursorPos", 2, u_one),
    API("ClipCursor", 1, u_one), API("DestroyIcon", 1, u_one), API("DestroyCursor", 1, u_one),
    API("GetKeyState", 1, u_GetKeyState), API("GetAsyncKeyState", 1, u_GetAsyncKeyState),
    API("RegisterWindowMessageA", 1, u_RegisterWindowMessage), API("RegisterWindowMessageW", 1, u_RegisterWindowMessage),
    API("MessageBeep", 1, u_MessageBeep), API("MessageBoxA", 4, u_MessageBoxA), API("MessageBoxW", 4, u_MessageBoxW),
    API("LoadStringA", 4, u_LoadStringA), API("LoadStringW", 4, u_LoadStringW),
    CAPI("wsprintfA", u_wsprintfA), CAPI("wsprintfW", u_wsprintfW), API("wvsprintfA", 3, u_wvsprintfA), API("wvsprintfW", 3, u_wvsprintfW),
    API("CharUpperA", 1, u_CharUpper), API("CharUpperW", 1, u_CharUpper),
    API("DrawTextA", 5, u_DrawTextA), API("DrawTextW", 5, u_DrawTextW),
    API("LoadMenuA", 2, u_LoadMenuA), API("LoadMenuW", 2, u_LoadMenuW), API("GetMenu", 1, u_GetMenu), API("SetMenu", 2, u_SetMenu),
    API("GetSubMenu", 2, u_GetSubMenu), API("EnableMenuItem", 3, u_EnableMenuItem), API("CheckMenuItem", 3, u_CheckMenuItem),
    API("CheckMenuRadioItem", 5, u_CheckMenuRadioItem), API("GetMenuState", 3, u_GetMenuState), API("DrawMenuBar", 1, u_one),
    API("CreateMenu", 0, u_CreateMenu), API("CreatePopupMenu", 0, u_CreateMenu), API("AppendMenuA", 4, u_AppendMenuA), API("AppendMenuW", 4, u_AppendMenuW),
    API("DestroyMenu", 1, u_DestroyMenu),
    API("LoadAcceleratorsA", 2, u_LoadAcceleratorsA), API("LoadAcceleratorsW", 2, u_LoadAcceleratorsW),
    API("TranslateAcceleratorA", 3, u_TranslateAccelerator), API("TranslateAcceleratorW", 3, u_TranslateAccelerator),
    API("DialogBoxParamA", 5, u_DialogBoxParamA), API("DialogBoxParamW", 5, u_DialogBoxParamW),
    API("CreateDialogParamA", 5, u_CreateDialogParamA), API("CreateDialogParamW", 5, u_CreateDialogParamW), API("EndDialog", 2, u_EndDialog),
    API("GetDlgItem", 2, u_GetDlgItem), API("GetDlgCtrlID", 1, u_GetDlgCtrlID),
    API("CheckDlgButton", 3, u_CheckDlgButton), API("IsDlgButtonChecked", 2, u_IsDlgButtonChecked), API("CheckRadioButton", 4, u_CheckRadioButton),
    API("SetDlgItemTextA", 3, u_SetDlgItemTextA), API("SetDlgItemTextW", 3, u_SetDlgItemTextW),
    API("GetDlgItemTextA", 4, u_GetDlgItemTextA), API("GetDlgItemTextW", 4, u_GetDlgItemTextW),
    API("SetDlgItemInt", 4, u_SetDlgItemInt), API("GetDlgItemInt", 4, u_GetDlgItemInt),
    API("SendDlgItemMessageA", 5, u_SendDlgItemMessage), API("SendDlgItemMessageW", 5, u_SendDlgItemMessage),
    API("SetRect", 5, u_SetRect), API("SetRectEmpty", 1, u_SetRectEmpty), API("CopyRect", 2, u_CopyRect), API("InflateRect", 3, u_InflateRect),
    API("OffsetRect", 3, u_OffsetRect), API("IntersectRect", 3, u_IntersectRect), API("UnionRect", 3, u_UnionRect),
    API("PtInRect", 3, u_PtInRect), API("IsRectEmpty", 1, u_IsRectEmpty), API("EqualRect", 2, u_EqualRect),
    STUB("WinHelpA", 4), STUB("WinHelpW", 4),
};
const uint32_t w32_api_user_n = sizeof w32_api_user / sizeof w32_api_user[0];
