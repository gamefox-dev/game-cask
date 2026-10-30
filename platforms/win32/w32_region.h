/* Rectangle subtraction for window DC visible regions. MIT. Coordinates are desktop pixels.
 * The disjoint output rectangles prevent double blending when excluded children overlap. */
#define W32_REGION_MAX 1024
static uint32_t visible_region(uint32_t hwnd, int32_t l, int32_t t, int32_t r, int32_t b, int32_t out[W32_REGION_MAX][4]) {
    int32_t cuts[NWND][4];
    uint32_t nc = w32_user_exclusions(hwnd, cuts), n = r > l && b > t ? 1u : 0u;
    out[0][0] = l; out[0][1] = t; out[0][2] = r; out[0][3] = b;
    for (uint32_t c = 0; c < nc; c++) {
        uint32_t old = n;
        for (uint32_t i = 0; i < old;) {
            int32_t a[4]; __builtin_memcpy(a, out[i], sizeof a);
            int32_t x0 = imax(a[0], cuts[c][0]), y0 = imax(a[1], cuts[c][1]);
            int32_t x1 = imin(a[2], cuts[c][2]), y1 = imin(a[3], cuts[c][3]);
            if (x1 <= x0 || y1 <= y0) { i++; continue; }
            /* Remove the old rect, including it in the old partition only until removal. */
            old--; n--;
            __builtin_memcpy(out[i], out[old], sizeof a);
            if (n > old) __builtin_memcpy(out[old], out[n], sizeof a);
            int32_t pieces[4][4] = {{a[0],a[1],a[2],y0},{a[0],y1,a[2],a[3]}, {a[0],y0,x0,y1},{x1,y0,a[2],y1}};
            for (uint32_t p = 0; p < 4; p++) if (pieces[p][2] > pieces[p][0] && pieces[p][3] > pieces[p][1]) {
                if (n >= W32_REGION_MAX) x86_fault("window visible region too complex", hwnd);
                __builtin_memcpy(out[n++], pieces[p], sizeof a);
            }
        }
    }
    return n;
}
