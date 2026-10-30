/* Original CC0. No BGT dependency: same normal -O2 STL/iostream source on both hosts. */
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
static uint32_t hash = 2166136261u;
static void add(unsigned x) { hash = (hash ^ x) * 16777619u; }
static void text(const std::string &s) { for (unsigned char c : s) add(c); }
int main() {
    std::vector<int> v;
    for (int i = 0; i < 257; ++i) v.push_back((i * 37 + 11) % 101);
    std::sort(v.begin(), v.end());
    for (int i : v) add(static_cast<unsigned>(i));
    std::cout << "cpprt vector=" << hash << '\n';
    hash = 2166136261u;
    std::string s = "portable";
    for (int i = 0; i < 30; ++i) s += ":string";
    s.replace(3, 4, "CRT"); s.insert(1, "++");
    text(s.substr(2, 117)); add(static_cast<unsigned>(s.find("string")));
    std::cout << "cpprt string=" << hash << '\n';
    hash = 2166136261u;
    std::map<std::string, int> m;
    for (int i : v) m[std::to_string(i % 17)] += i;
    for (const auto &p : m) { text(p.first); add(static_cast<unsigned>(p.second)); }
    std::cout << "cpprt map=" << hash << '\n';
    hash = 2166136261u;
    std::ostringstream out;
    out << "value:" << 123456 << ':' << std::hex << 0xabc;
    text(out.str());
    std::istringstream in("42 word 125");
    int a = 0, b = 0; std::string word;
    in >> a >> word >> b; add(static_cast<unsigned>(a)); add(static_cast<unsigned>(b)); text(word);
    std::cout << "cpprt iostream=" << hash << '\n';
    std::cout << "cpprt result=" << ((a == 42 && b == 125 && word == "word") ? "PASS" : "FAIL") << std::endl;
}
