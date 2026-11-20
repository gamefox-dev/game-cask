/* Original CC0-1.0. K50 delta review vK50c: deferred upload copies are addressed by journal offset.
 * Several upload-bearing lists are journaled, a large one forces the journal to grow (freeing the
 * old block), the freed block is then reused (and zero-filled) by the real host allocator, and only
 * then is the journal submitted. Every recorded upload must still carry its own bytes. */
static void journal_growth(void) {
    deferring = 1;
    for (uint32_t i = 1; i <= 6; i++) {
        uint8_t *data = glp_alloc(200); CHECK(data);
        memset(data, (int)(0x11 * i), 200);
        uint32_t w[5] = {i, 1, 200, PTR(data), 200};
        begin(); op(0x40, w, 5); CHECK(submit()); glp_free(data, 200);
        if (i == 3) { /* growth while three upload copies are already journaled */
            uint8_t *big = glp_alloc(100000); CHECK(big); memset(big, 0x5a, 100000);
            uint32_t f[4] = {300, 0, PTR(big), 100000};
            uint32_t before = journal_cap;
            begin(); op(0x41, f, 4); CHECK(submit()); glp_free(big, 100000);
            CHECK(journal_cap > before);
            /* Reuse every free host block (the freed journal block included) before submission. */
            static void *scribble[4096]; uint32_t n = 0, start = top;
            while (n < 4096 && top == start && (scribble[n] = glp_alloc(4000))) memset(scribble[n++], 0xee, 4000);
            CHECK(top != start);
            while (n) glp_free(scribble[--n], 4000);
        }
    }
    CHECK(gl_deferred_lists == 7 && !device_buffers[1][0]);
    deferring = 0; journal_submit();
    for (uint32_t i = 1; i <= 6; i++) for (uint32_t j = 0; j < 200; j++) CHECK(device_buffers[i][j] == 0x11 * i);
    CHECK(!journal_len && !gl_deferred_rejects);
    /* Other submitters (GDI/legacy lists) count against the same host frame (vK50c item 3). */
    host_frame_sync(); frame_use = (gpu_usage_t){0};
    for (uint32_t i = 0; i < 4; i++) recent_frames[i] = (gpu_usage_t){0};
    recent_frames[0].lists = 10;
    CHECK(next_frame_fits());
    for (uint32_t i = 0; i < 247; i++) w32_gl_charge_foreign(64, 2);
    CHECK(!next_frame_fits() && frame_use.lists == 247 && frame_use.vertices == 247 * 16);
    puts("journal growth keeps every deferred upload byte-exact OK");
}
