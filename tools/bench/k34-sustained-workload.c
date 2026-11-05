/* Original CC0-1.0 K34 lifted-code workload. */
#include <windows.h>
#include <stdint.h>

typedef struct { uint32_t tag; union { uint64_t u; int64_t i; const char *s; }; } value_t;
typedef struct { uint32_t hash; uint32_t value; const char *key; } bucket_t;
static volatile uint8_t memory_image[8192];
static void *volatile relocation_anchor = (void *)&relocation_anchor;
static bucket_t buckets[64];
static const char words[][12] = {"alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel"};
static uint32_t slen(const char *s) { uint32_t n = 0; while (s[n]) n++; return n; }
static int seq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (uint8_t)*a == (uint8_t)*b; }

__declspec(noinline) static uint32_t mix32(uint32_t x, uint32_t y) {
  x ^= y + 0x9e3779b9u + (x << 6) + (x >> 2);
  x = (x ^ (x >> 16)) * 0x45d9f3bu;
  return x ^ (x >> 16);
}
__declspec(noinline) static uint32_t key_hash(const char *s) {
  uint32_t h = 2166136261u;
  while (*s) h = (h ^ (uint8_t)*s++) * 16777619u;
  return h;
}
__declspec(noinline) static uint32_t lookup(const char *key, uint32_t seed) {
  uint32_t h = key_hash(key), p = (h ^ seed) & 63u;
  for (uint32_t n = 0; n < 64; n++) {
    bucket_t *b = &buckets[(p + n) & 63u];
    if (!b->key) return mix32(h, seed);
    if (b->hash == h && seq(b->key, key)) return b->value ^ h;
  }
  return mix32(h, seed ^ 0xa5a5a5a5u);
}
__declspec(noinline) static value_t tagged(uint32_t op, uint32_t index, uint32_t seed) {
  value_t v;
  if ((op & 3u) == 0) { v.tag = 0; v.u = mix32(index, seed); }
  else if ((op & 3u) == 1) { v.tag = 1; v.i = (int64_t)(int32_t)(index ^ seed) - 17; }
  else if ((op & 3u) == 2) { v.tag = 2; v.s = words[(index + seed) & 7u]; }
  else { v.tag = 3; v.u = lookup(words[index & 7u], seed); }
  return v;
}
__declspec(noinline) static uint32_t dispatch(const uint8_t *program, uint32_t count, uint32_t seed) {
  uint32_t acc = seed;
  value_t regs[8] = {0};
  for (uint32_t pc = 0; pc < count; pc++) {
    uint8_t op = program[pc & 255u];
    uint32_t a = (op + pc) & 7u, b = (op >> 3) & 7u;
    switch (op & 15u) {
      case 0: regs[a] = tagged(op >> 4, pc, acc); break;
      case 1: regs[a].u = mix32((uint32_t)regs[a].u, (uint32_t)regs[b].u); regs[a].tag = 0; break;
      case 2: acc += (uint32_t)regs[a].u ^ (uint32_t)regs[b].u; break;
      case 3: acc ^= lookup(words[(pc + op) & 7u], acc); break;
      case 4: memory_image[(acc + pc) & 8191u] = (uint8_t)(regs[a].u ^ acc); break;
      case 5: regs[a].u += memory_image[(acc + pc * 3u) & 8191u]; regs[a].tag = 0; break;
      case 6: if (regs[a].tag == 2) acc += (uint32_t)slen(regs[a].s); else acc ^= (uint32_t)regs[a].u; break;
      case 7: if (regs[a].tag == 2 && seq(regs[a].s, words[(pc + seed) & 7u])) acc++; break;
      case 8: regs[a].i = (int64_t)(int32_t)acc - (int64_t)(int32_t)regs[b].i; regs[a].tag = 1; break;
      case 9: acc = (acc << 5) | (acc >> 27); acc += (uint32_t)regs[a].i; break;
      case 10: memory_image[(pc * 13u + acc) & 8191u] ^= (uint8_t)lookup(words[op & 7u], pc); break;
      case 11: regs[a] = tagged((op >> 4) + 1u, acc, pc); break;
      case 12: acc = mix32(acc, memory_image[(pc + 31u) & 8191u]); break;
      case 13: if (regs[b].tag == 1) regs[a].u += regs[b].u; else regs[a].u ^= regs[b].u; regs[a].tag = 0; break;
      case 14: acc += (uint32_t)key_hash(words[(op + pc) & 7u]); break;
      default: acc ^= (uint32_t)regs[a].u + pc; break;
    }
    memory_image[(pc * 7u + a) & 8191u] ^= (uint8_t)acc;
  }
  return acc;
}
int main(void) {
  (void)relocation_anchor;
  static uint8_t program[256];
  for (uint32_t i = 0; i < 256; i++) program[i] = (uint8_t)(i * 37u + 11u);
  for (uint32_t i = 0; i < 64; i++) { buckets[i].hash = key_hash(words[i & 7u]); buckets[i].value = i * 19u + 3u; buckets[i].key = words[i & 7u]; }
  uint32_t checksum = 1;
  for (uint32_t frame = 0; frame < 256; frame++) checksum = dispatch(program, 256, checksum + frame);
  char text[80]; wsprintfA(text, "k34 workload checksum %08x", checksum); OutputDebugStringA(text);
  uint32_t frame = 256;
  for (;;) {
    checksum = dispatch(program, 256, checksum + frame++);
    Sleep(5);
  }
}
