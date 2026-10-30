#!/usr/bin/env python3
"""ptyd: a tiny tmux substitute (tmux is not installed on this host).

Spawns a command in a pty of fixed size, keeps a minimal VT100/xterm screen
model of its output, and serves a Unix-socket control protocol:

    snap            -> current screen text (rows joined by \n, right-trimmed)
    send <hex>      -> write raw bytes to the pty
    alive           -> "1" or "0 <exitcode>"
    quit            -> terminate child (SIGTERM), exit
    raw             -> path of the raw byte log

usage: ptyd.py --sock S --cols 200 --rows 50 --cwd DIR --log RAW -- cmd args...
Stdlib only. Not a full terminal emulator: enough for pi's TUI.
"""
import argparse, fcntl, os, pty, select, signal, socket, struct, sys, termios, time


class Screen:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.reset()
        self.bracketed = False
        self.alt = False

    def reset(self):
        self.g = [[" "] * self.cols for _ in range(self.rows)]
        self.x = self.y = 0
        self.top, self.bot = 0, self.rows - 1
        self.saved = (0, 0)
        self.wrap_pending = False

    def blank_row(self):
        return [" "] * self.cols

    def scroll_up(self, n=1):
        for _ in range(n):
            del self.g[self.top]
            self.g.insert(self.bot, self.blank_row())

    def scroll_down(self, n=1):
        for _ in range(n):
            del self.g[self.bot]
            self.g.insert(self.top, self.blank_row())

    def lf(self):
        if self.y == self.bot:
            self.scroll_up()
        elif self.y < self.rows - 1:
            self.y += 1

    def put(self, ch):
        if self.wrap_pending:
            self.x = 0
            self.lf()
            self.wrap_pending = False
        self.g[self.y][self.x] = ch
        if self.x == self.cols - 1:
            self.wrap_pending = True
        else:
            self.x += 1

    def text(self):
        return "\n".join("".join(r).rstrip() for r in self.g)


class Parser:
    def __init__(self, scr, reply):
        self.s = scr
        self.reply = reply
        self.state = "g"
        self.buf = ""
        self.dec = __import__("codecs").getincrementaldecoder("utf-8")("replace")

    def feed(self, data):
        for ch in self.dec.decode(data):
            self.step(ch)

    def step(self, ch):
        s = self.s
        st = self.state
        if st == "g":
            o = ord(ch)
            if ch == "\x1b":
                self.state = "esc"
            elif ch == "\n":
                s.wrap_pending = False
                s.lf()
            elif ch == "\r":
                s.x = 0
                s.wrap_pending = False
            elif ch == "\b":
                s.x = max(0, s.x - 1)
                s.wrap_pending = False
            elif ch == "\t":
                s.x = min(s.cols - 1, (s.x // 8 + 1) * 8)
            elif o < 32 or o == 127:
                pass
            else:
                s.put(ch)
        elif st == "esc":
            if ch == "[":
                self.state, self.buf = "csi", ""
            elif ch in "]PX^_":
                self.state, self.buf = "str", ""
            elif ch == "7":
                s.saved = (s.x, s.y); self.state = "g"
            elif ch == "8":
                s.x, s.y = s.saved; self.state = "g"
            elif ch == "M":
                if s.y == s.top:
                    s.scroll_down()
                else:
                    s.y = max(0, s.y - 1)
                self.state = "g"
            elif ch == "c":
                s.reset(); self.state = "g"
            elif ch in "()#%":
                self.state = "skip1"
            else:
                self.state = "g"
        elif st == "skip1":
            self.state = "g"
        elif st == "str":
            # OSC/DCS/APC: ends with BEL or ESC \
            if ch == "\x07":
                self.state = "g"
            elif ch == "\x1b":
                self.state = "stresc"
        elif st == "stresc":
            self.state = "g"
        elif st == "csi":
            if "\x40" <= ch <= "\x7e":
                self.csi(self.buf, ch)
                self.state = "g"
            else:
                self.buf += ch

    def csi(self, params, fin):
        s = self.s
        priv = params[:1] in ("?", ">", "<", "=")
        pstr = params.lstrip("?><=")
        try:
            a = [int(p) if p else 0 for p in pstr.replace(":", ";").split(";")] if pstr else []
        except ValueError:
            a = []
        def n(i, d=1):
            return a[i] if len(a) > i and a[i] > 0 else d
        s.wrap_pending = False if fin in "ABCDHfGdEF" else s.wrap_pending
        if fin == "A": s.y = max(s.top if s.y >= s.top else 0, s.y - n(0))
        elif fin == "B": s.y = min(s.rows - 1, s.y + n(0))
        elif fin == "C": s.x = min(s.cols - 1, s.x + n(0))
        elif fin == "D": s.x = max(0, s.x - n(0))
        elif fin == "E": s.y = min(s.rows - 1, s.y + n(0)); s.x = 0
        elif fin == "F": s.y = max(0, s.y - n(0)); s.x = 0
        elif fin == "G": s.x = min(s.cols - 1, n(0) - 1)
        elif fin in "Hf":
            s.y = min(s.rows - 1, n(0) - 1); s.x = min(s.cols - 1, n(1) - 1)
        elif fin == "d": s.y = min(s.rows - 1, n(0) - 1)
        elif fin == "J":
            m = a[0] if a else 0
            if m == 0:
                s.g[s.y][s.x:] = [" "] * (s.cols - s.x)
                for r in range(s.y + 1, s.rows): s.g[r] = s.blank_row()
            elif m == 1:
                s.g[s.y][:s.x + 1] = [" "] * (s.x + 1)
                for r in range(0, s.y): s.g[r] = s.blank_row()
            elif m in (2, 3):
                if m == 2:
                    for r in range(s.rows): s.g[r] = s.blank_row()
        elif fin == "K":
            m = a[0] if a else 0
            if m == 0: s.g[s.y][s.x:] = [" "] * (s.cols - s.x)
            elif m == 1: s.g[s.y][:s.x + 1] = [" "] * (s.x + 1)
            else: s.g[s.y] = s.blank_row()
        elif fin == "L":
            for _ in range(n(0)):
                if s.top <= s.y <= s.bot:
                    del s.g[s.bot]; s.g.insert(s.y, s.blank_row())
        elif fin == "M":
            for _ in range(n(0)):
                if s.top <= s.y <= s.bot:
                    del s.g[s.y]; s.g.insert(s.bot, s.blank_row())
        elif fin == "P":
            k = n(0); row = s.g[s.y]
            del row[s.x:s.x + k]; row.extend([" "] * (s.cols - len(row)))
        elif fin == "@":
            k = n(0); row = s.g[s.y]
            row[s.x:s.x] = [" "] * k; del row[s.cols:]
        elif fin == "X":
            k = n(0)
            for i in range(s.x, min(s.cols, s.x + k)): s.g[s.y][i] = " "
        elif fin == "S": s.scroll_up(n(0))
        elif fin == "T": s.scroll_down(n(0))
        elif fin == "r":
            s.top = n(0) - 1
            s.bot = (a[1] - 1) if len(a) > 1 and a[1] > 0 else s.rows - 1
            s.top = max(0, min(s.top, s.rows - 1)); s.bot = max(s.top, min(s.bot, s.rows - 1))
            s.x = s.y = 0
        elif fin == "s" and not priv: s.saved = (s.x, s.y)
        elif fin == "u" and not priv: s.x, s.y = s.saved
        elif fin in "hl" and priv:
            on = fin == "h"
            for code in a:
                if code == 2004: s.bracketed = on
                elif code in (1049, 1047, 47):
                    s.alt = on
                    if on:
                        s.x = s.y = 0
                        for r in range(s.rows): s.g[r] = s.blank_row()
        elif fin == "n" and a == [6]:
            self.reply(("\x1b[%d;%dR" % (s.y + 1, s.x + 1)).encode())
        elif fin == "c" and not priv:
            self.reply(b"\x1b[?62;c")
        elif fin == "t" and a[:1] == [16]:
            self.reply(b"\x1b[6;16;8t")
        elif fin == "t" and a[:1] == [18]:
            self.reply(("\x1b[8;%d;%dt" % (s.rows, s.cols)).encode())
        # m (SGR) and everything else: ignored


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sock", required=True)
    ap.add_argument("--cols", type=int, default=200)
    ap.add_argument("--rows", type=int, default=50)
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--log", required=True)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(args.cwd)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS=str(args.cols), LINES=str(args.rows))
        os.execvpe(cmd[0], cmd, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
    os.kill(pid, signal.SIGWINCH)

    scr = Screen(args.cols, args.rows)
    parser = Parser(scr, lambda b: os.write(fd, b))
    log = open(os.path.abspath(args.log), "wb")
    sockdir, sockname = os.path.split(os.path.abspath(args.sock))
    log = open(args.log, "ab") if False else log
    os.chdir(sockdir)  # sun_path is limited to ~104 bytes: bind via a relative name
    if os.path.exists(sockname): os.unlink(sockname)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sockname); srv.listen(8)
    exit_code = None
    last_out = [time.time()]

    def reap():
        nonlocal exit_code
        if exit_code is None:
            try:
                p, st = os.waitpid(pid, os.WNOHANG)
                if p:
                    exit_code = os.waitstatus_to_exitcode(st)
            except ChildProcessError:
                exit_code = -1

    while True:
        rl = [srv] + ([fd] if exit_code is None else [])
        r, _, _ = select.select(rl, [], [], 0.2)
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if data:
                log.write(data); log.flush()
                parser.feed(data)
                last_out[0] = time.time()
            else:
                time.sleep(0.05)
        reap()
        if srv in r:
            c, _ = srv.accept()
            c.settimeout(5)
            try:
                line = b""
                while not line.endswith(b"\n"):
                    ch = c.recv(65536)
                    if not ch: break
                    line += ch
                cmdl = line.decode().strip().split(" ", 1)
                op, rest = cmdl[0], (cmdl[1] if len(cmdl) > 1 else "")
                if op == "snap":
                    out = scr.text()
                elif op == "send":
                    if exit_code is None:
                        os.write(fd, bytes.fromhex(rest))
                    out = "ok"
                elif op == "alive":
                    out = "1" if exit_code is None else "0 %s" % exit_code
                elif op == "idle":   # seconds since last output
                    out = "%.2f" % (time.time() - last_out[0])
                elif op == "bracketed":
                    out = "1" if scr.bracketed else "0"
                elif op == "quit":
                    c.sendall(b"ok"); c.close()
                    if exit_code is None:
                        try: os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError: pass
                        time.sleep(0.5); reap()
                    break
                else:
                    out = "?"
                c.sendall(out.encode())
            finally:
                c.close()
    srv.close()
    try: os.unlink(sockname)
    except OSError: pass


if __name__ == "__main__":
    main()
