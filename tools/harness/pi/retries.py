"""Current-attempt provider failures and reset-aware scheduling (no provider dependencies)."""
from datetime import datetime
import json
import math
from pathlib import Path
import re

TRANSIENT = re.compile(
    r'\b(?:HTTP(?:/[\d.]+)?(?:\s+error)?|status(?:\s+code)?|error)[\s\"\':=]*'
    r'(?:429|5\d\d)\b|currently overloaded|request timed out|\busage_limit_reached\b', re.I)


def error_text(directory):
    directory = Path(directory)
    err = directory / 'stderr.txt'
    chunks = [err.read_text(errors='replace')[-131072:]] if err.exists() else []
    # JSON event streams and session errors need not appear in stderr. Do not classify normal tool text.
    files = [directory / 'stdout.txt', *directory.glob('sessions/*.jsonl')]
    for path in files:
        if not path.exists():
            continue
        last_assistant = None
        for line in path.read_text(errors='replace').splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            message = event.get('message', event)
            if isinstance(message, dict) and message.get('role') == 'assistant':
                last_assistant = message
            elif event.get('type') in ('error', 'provider_error'):
                chunks.append(json.dumps(event))
        if last_assistant and last_assistant.get('stopReason') == 'error':
            chunks.append(json.dumps(last_assistant))
    return '\n'.join(chunks)


def reset_delay(raw, now):
    # Providers commonly embed an escaped JSON body inside an errorMessage string.
    raw = raw.replace('\\"', '"')
    delays = []
    for key, value in re.findall(r'["\']?(resets_at|resets_in_seconds)["\']?\s*[:=]\s*["\']?([^\s,"\'}]+)', raw):
        try:
            if key == 'resets_in_seconds':
                delay = float(value)
            else:
                try:
                    stamp = float(value)
                    if stamp > 1e12:
                        stamp /= 1000  # millisecond timestamps
                except ValueError:
                    stamp = datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
                delay = stamp - now
            if math.isfinite(delay):
                delays.append(max(0, delay))
        except (ValueError, OverflowError):
            pass
    return max(delays) if delays else None


def retry_plan(raw, attempt, backoff, now, jitter):
    if not TRANSIENT.search(raw):
        return None
    reset = reset_delay(raw, now) if re.search(r'\b429\b|usage_limit_reached', raw, re.I) else None
    return {'reason': 'provider-reset' if reset is not None else 'transient-provider',
            'delaySeconds': (reset if reset is not None else min(backoff * 2 ** (attempt - 1), 3600)) + jitter}
