#!/usr/bin/env python3
"""Private pi driver. Process exit, not extension phase, owns completion."""
import glob
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
TRANSIENT = re.compile(r"\b(?:HTTP(?:/[\d.]+)?(?:\s+error)?|status(?:\s+code)?|error)\s*[:=]?\s*(429|500|502|503|504)\b", re.I)


def main():
    if len(sys.argv) != 4:
        raise ValueError('usage: run-pi.sh WORKDIR PROMPT_FILE OUT_FILE')
    work, prompt, out = map(lambda p: str(Path(p).resolve()), sys.argv[1:])
    attempts = int(os.environ.get('PI_MAX_ATTEMPTS', '1'))
    backoff = float(os.environ.get('PI_RETRY_BACKOFF', '30'))
    if attempts < 1 or attempts > 100 or not 0 <= backoff <= 86400:
        raise ValueError('invalid retry configuration')
    if not Path(work).is_dir() or not Path(prompt).is_file():
        raise ValueError('missing workdir or prompt')
    if Path(out).exists() or Path(out + '.d').exists():
        raise ValueError('refusing to overwrite ' + out + ' or its .d directory')
    env = dict(os.environ)
    # Never attribute nested harness runs to the invoking lane by inherited session metadata.
    for key in ('PI_SESSION_ID', 'PI_SESSION_FILE'):
        env.pop(key, None)
    env['PI_BRIDGE_RUN_ID'] = str(uuid.uuid4())
    if env.get('PI_MODEL') and '/' not in env['PI_MODEL'] and env.get('PI_PROVIDER'):
        env['PI_MODEL'] = env['PI_PROVIDER'] + '/' + env['PI_MODEL']
    bridge = env.get('PI_BRIDGE') == '1'

    def lifecycle(action, code=None):
        args = ['node', str(HERE / 'bridge/cli.mjs'), action, '--lane', env.get('PI_LANE', '')]
        if code is not None:
            args.append(str(code))
        return subprocess.run(args, env=env, stdout=subprocess.DEVNULL, timeout=15).returncode

    # If the lane already has a live driver (e.g. a nested test), fail closed, not takeover.
    if bridge and lifecycle('started'):
        return 2
    cancelled = [None]
    child = [None]

    def stop(signum, _frame):
        cancelled[0] = signum
        if child[0] is not None:
            try:
                os.killpg(child[0].pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    history = []
    code = 2
    try:
        for attempt in range(1, attempts + 1):
            if cancelled[0]:
                break
            current = out if attempt == 1 else out + '.attempt-' + str(attempt)
            if Path(current).exists() or Path(current + '.d').exists():
                print('refusing to overwrite ' + current + ' or its .d directory', file=sys.stderr)
                code = 2
                break  # Never inspect a pre-existing attempt's stderr or session.
            child[0] = subprocess.Popen(['bash', str(HERE / 'drive-pi.sh'), work, prompt, current],
                                        env=env, start_new_session=True)
            while True:
                try:
                    code = child[0].wait(timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    if cancelled[0]:
                        try:
                            child[0].wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            pass
                        break
            # Always remove descendants on timeout/cancellation, even if the shell exited first.
            if cancelled[0] or code == 124:
                try:
                    os.killpg(child[0].pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child[0].wait()
            child[0] = None
            code = 128 - code if code < 0 else code
            history.append({'attempt': attempt, 'out': current, 'exit': code})
            if cancelled[0] or code in (0, 124) or code >= 128 or attempt == attempts or env.get('PI_DRIVE_MODE', 'print') != 'print':
                break
            # Deliberately read ONLY this attempt, never a glob of historical stderr files.
            err = Path(current + '.d/stderr.txt')
            if not err.exists() or not TRANSIENT.search(err.read_text(errors='replace')):
                break
            sessions = glob.glob(current + '.d/sessions/*.jsonl')
            if not sessions:
                break  # No conversation to resume. Never silently restart the task.
            env['PI_FORK_SESSION'] = max(sessions, key=os.path.getmtime)
            prompt = out + '.d/retry.md'
            Path(prompt).write_text('Continue the same task from the last session after a transient provider failure. '
                                    'Preserve completed work; do not restart or repeat completed actions.\n')
            delay = min(backoff * 2 ** (attempt - 1), 3600)
            print(f'[run-pi] retry {attempt + 1}/{attempts} in {delay:g}s; fork={env["PI_FORK_SESSION"]}', file=sys.stderr)
            deadline = time.monotonic() + delay
            while time.monotonic() < deadline and not cancelled[0]:
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        if cancelled[0]:
            code = 128 + cancelled[0]
        if Path(out + '.d').is_dir():
            Path(out + '.d/driver.json').write_text(json.dumps({'exit': code, 'attempts': history}) + '\n')
            if history and history[-1]['out'] != out:
                latest = Path(history[-1]['out'])
                if latest.exists():
                    Path(out).write_bytes(latest.read_bytes())
        return code
    finally:
        if bridge:
            try:
                lifecycle('ended', 128 + cancelled[0] if cancelled[0] else code)
            except (OSError, subprocess.TimeoutExpired) as error:
                print(f'bridge exit notification failed: {error}', file=sys.stderr)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
