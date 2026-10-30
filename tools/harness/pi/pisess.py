#!/usr/bin/env python3
"""pisess.py state|render|final SESSIONDIR   (pi session JSONL helpers; stdlib only)
state : one JSON line {file, entries, last_role, stop_reason, age_s, user_msgs}
render: human-readable transcript (user, assistant text, tool calls+results trimmed, usage/cost)
final : text of the last assistant message
"""
import glob, json, os, sys, time

def load(d):
    fs = sorted(glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True), key=os.path.getmtime)
    if not fs: return None, []
    rows = []
    for l in open(fs[-1], errors="replace"):
        try: rows.append(json.loads(l))
        except Exception: pass   # a half-written last line
    return fs[-1], rows

def text_of(c):
    if isinstance(c, str): return c
    return "".join(x.get("text", "") for x in c if x.get("type") == "text")

def main():
    op, d = sys.argv[1], sys.argv[2]
    f, rows = load(d)
    msgs = [r["message"] for r in rows if r.get("type") == "message"]
    if op == "state":
        last = msgs[-1] if msgs else {}
        print(json.dumps({"file": f, "entries": len(rows), "last_role": last.get("role"),
              "stop_reason": last.get("stopReason"), "user_msgs": sum(m.get("role") == "user" for m in msgs),
              "age_s": round(time.time() - os.path.getmtime(f), 1) if f else None}))
    elif op == "final":
        for m in reversed(msgs):
            if m.get("role") == "assistant":
                print(text_of(m["content"])); break
    elif op == "render":
        tot = 0.0
        for r in rows:
            t = r.get("type")
            if t in ("model_change", "thinking_level_change"):
                print("[%s] %s" % (t, {k: v for k, v in r.items() if k in ("provider", "modelId", "thinkingLevel")}))
            if t != "message": continue
            m = r["message"]; role = m.get("role")
            if role == "user": print("\n=== USER ===\n" + text_of(m["content"]))
            elif role == "assistant":
                for c in m["content"]:
                    if c["type"] == "text": print("\n=== ASSISTANT ===\n" + c["text"])
                    elif c["type"] == "toolCall": print("[tool] %s %s" % (c["name"], json.dumps(c.get("arguments"))[:300]))
                tot += (m.get("usage") or {}).get("cost", {}).get("total", 0) or 0
            elif role == "toolResult":
                s = text_of(m["content"]); print("[result] " + (s[:400] + (" ...(%d chars)" % len(s) if len(s) > 400 else "")).replace("\n", "\n         "))
        print("\n[total cost USD] %.4f" % tot)

main()
