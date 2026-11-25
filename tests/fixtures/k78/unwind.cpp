// Original CC0-1.0. K78 stress fixture: C++ exceptions and unwinding (SEH: RaiseException, RtlUnwindEx, catch
// funclets) through fast lifted frames that keep values in callee-saved registers, tiny inlinable throwers, virtual
// calls, destructors, rethrow, throws past the fast call-depth cap, and std::function/lambda tables.
#include <windows.h>
#include <cstdint>
#include <functional>
#include <memory>
#include <stdexcept>
#include <vector>

static uint64_t hash = 1469598103934665603ull;
static void mix(uint64_t v) { hash = (hash ^ v) * 1099511628211ull; }
static void report(const char *name) {
    char line[96]; wsprintfA(line, "k78 %s %08x%08x", name, (unsigned)(hash >> 32), (unsigned)hash);
    OutputDebugStringA(line); hash = 1469598103934665603ull;
}
struct Fail { uint64_t code; };
static uint64_t dtors;
struct Guard { uint64_t v; explicit Guard(uint64_t x) : v(x) {} ~Guard() { dtors = dtors * 3 + v; } };

__attribute__((noinline)) static void tiny_throw(uint64_t v) { if (v & 1) throw Fail{v}; }
__attribute__((noinline)) static uint64_t work(uint64_t a, uint64_t b) { return a * 0x9e3779b97f4a7c15ull + (b >> 3); }
__attribute__((noinline)) static uint64_t frames(uint64_t n, uint64_t a, uint64_t b, uint64_t c) {
    Guard g(n);
    uint64_t x = work(a, n), y = work(b, x), z = c ^ y;
    if (n == 0) { tiny_throw(x | (a & 1)); return x + y + z; }
    uint64_t r = frames(n - 1, y, z, x);
    return r + x * 3 + y * 5 + z * 7;
}
static void exceptions() {
    for (uint64_t i = 0; i < 24; i++) {
        uint64_t keep = i * 77, other = i ^ 0x5a;
        try { mix(frames(i % 9, i, keep, other)); }
        catch (const Fail &f) { mix(f.code + keep + other); }
        mix(dtors); mix(keep * other);
    }
    report("exceptions");
}
// Throws through more than 128 fast frames (the depth cap hands frames to the driver).
__attribute__((noinline)) static uint64_t deep_throw(uint64_t n, uint64_t acc) {
    if (n == 0) throw Fail{acc};
    uint64_t v = work(acc, n);
    return deep_throw(n - 1, v) + v;
}
static void deep() {
    for (uint64_t n = 100; n < 400; n += 70) {
        uint64_t keep = n * 13;
        try { mix(deep_throw(n, n)); } catch (const Fail &f) { mix(f.code ^ keep); }
    }
    report("deep-throw");
}
// Virtual calls, rethrow, nested try, std::exception hierarchy, destructors of heap objects.
struct Shape { virtual ~Shape() { dtors += 11; } virtual uint64_t area(uint64_t k) const = 0; };
struct Sq : Shape { uint64_t s; explicit Sq(uint64_t v) : s(v) {} uint64_t area(uint64_t k) const override { if (k % 7 == 3) throw std::runtime_error("sq"); return s * s + k; } };
struct Tri : Shape { uint64_t b, h; Tri(uint64_t x, uint64_t y) : b(x), h(y) {} uint64_t area(uint64_t k) const override { if (k % 11 == 5) throw Fail{b}; return b * h / 2 + k; } };
__attribute__((noinline)) static uint64_t total(const std::vector<std::unique_ptr<Shape>> &v, uint64_t k) {
    uint64_t t = 0;
    for (const auto &s : v) {
        try { t += s->area(k); }
        catch (const std::exception &) { t ^= 0x1234; throw; }
    }
    return t;
}
static void virtuals() {
    std::vector<std::unique_ptr<Shape>> v;
    for (uint64_t i = 0; i < 9; i++) { if (i & 1) v.emplace_back(new Sq(i + 2)); else v.emplace_back(new Tri(i + 1, i + 5)); }
    for (uint64_t k = 0; k < 40; k++) {
        try { try { mix(total(v, k)); } catch (const Fail &f) { mix(f.code * 5); throw std::logic_error("again"); } }
        catch (const std::runtime_error &e) { mix(e.what()[0] + k); }
        catch (const std::logic_error &e) { mix(e.what()[1] + k * 3); }
    }
    v.clear(); mix(dtors);
    report("virtual-rethrow");
}
// std::function / lambda tables with captures, called in a loop that also throws.
static void functions() {
    std::vector<std::function<uint64_t(uint64_t)>> fs;
    for (uint64_t i = 0; i < 6; i++) fs.push_back([i](uint64_t x) { if (x == 17 + i) throw Fail{x}; return x * (i + 1) + i; });
    uint64_t acc = 1;
    for (uint64_t x = 0; x < 60; x++) {
        try { for (auto &f : fs) acc = f(acc % 97 + x) ^ (acc << 1); } catch (const Fail &f) { acc += f.code * 31; }
        mix(acc);
    }
    report("function-tables");
}
int main() {
    exceptions(); deep(); virtuals(); functions();
    OutputDebugStringA("k78 done");
    for (;;) Sleep(5);
}
