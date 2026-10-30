#!/usr/bin/env bash
# ptyctl.sh SOCK OP [ARG...]  -- talk to a ptyd.py session
#   snap | alive | idle | bracketed | quit
#   text "literal text"   (typed as-is)
#   key  Enter|Esc|Tab|Up|Down|Left|Right|C-c|C-d|C-l|S-Tab|BSpace
#   paste "text"          (bracketed paste if the app enabled it, else raw)
set -u
SOCK=$1; OP=$2; shift 2
send_hex() { python3 - "$SOCK" "$1" <<'E'
import socket,sys
import os; d,b=os.path.split(os.path.abspath(sys.argv[1])); os.chdir(d); s=socket.socket(socket.AF_UNIX); s.connect(b); s.sendall(("send "+sys.argv[2]+"\n").encode()); print(s.recv(100).decode())
E
}
raw() { python3 - "$SOCK" "$1" <<'E'
import socket,sys
import os; d,b=os.path.split(os.path.abspath(sys.argv[1])); os.chdir(d); s=socket.socket(socket.AF_UNIX); s.connect(b); s.sendall((sys.argv[2]+"\n").encode())
out=b""
while True:
    c=s.recv(65536)
    if not c: break
    out+=c
sys.stdout.write(out.decode())
E
}
hex() { python3 -c 'import sys;sys.stdout.write(sys.argv[1].encode().hex())' "$1"; }
case "$OP" in
  snap|alive|idle|bracketed|quit) raw "$OP" ;;
  text)  send_hex "$(hex "$1")" ;;
  paste)
    if [ "$(raw bracketed)" = 1 ]; then send_hex "$(hex $'\e[200~')$(hex "$1")$(hex $'\e[201~')"; else send_hex "$(hex "$1")"; fi ;;
  key)
    case "$1" in
      Enter) h=0d;; Esc) h=1b;; Tab) h=09;; Up) h=1b5b41;; Down) h=1b5b42;; Right) h=1b5b43;; Left) h=1b5b44;;
      C-c) h=03;; C-d) h=04;; C-l) h=0c;; S-Tab) h=1b5b5a;; BSpace) h=7f;; C-u) h=15;;
      *) echo "unknown key $1" >&2; exit 2;;
    esac
    send_hex "$h" ;;
  *) echo "unknown op" >&2; exit 2;;
esac
