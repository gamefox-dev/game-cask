// @bgt-examples: none
// Leaf admission is deliberately an explicit, narrow allowlist. Adding a callback,
// scheduler or SEH-capable implementation must not silently grow the native call graph.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../support/headless";
it("only the audited CRT/thread implementations have typed leaf adapters", () => {
  const crt = readFileSync(join(ROOT,"platforms/win32/w32_crt.c"),"utf8");
  const list = crt.slice(crt.indexOf("#define CRT_LEAVES(X)"),crt.indexOf("#define LEAF_WRAP"));
  expect([...list.matchAll(/X\((c_\w+)\)/g)].map(m=>m[1])).toEqual([
    "c_malloc","c_free","c_calloc","c_realloc","c_strlen","c_wcslen",
    "c_strcmp","c_wcscmp","c_strncmp","c_wcsncmp",
  ]);
  const thread = readFileSync(join(ROOT,"platforms/win32/w32_thread.c"),"utf8");
  const registry = thread.slice(thread.indexOf("w32_leaf_fn w32_thread_leaf("),thread.indexOf("#define IS(n)"));
  expect([...registry.matchAll(/\{"(\w+)",leaf_\w+}/g)].map(m=>m[1])).toEqual([
    "GetLastError","SetLastError","GetCurrentThreadId","TlsGetValue",
  ]);
});
