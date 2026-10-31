#!/usr/bin/env python3
"""Validate a lane queue before side effects; seed only the explicitly supplied cpa config."""
import json
import os
from pathlib import Path
import re
import shutil
import sys


def validate(manifest, bridge_port):
    lanes, ports, paths = set(), {int(bridge_port)}, []
    rows = []
    for line in Path(manifest).read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        fields = line.split('|')
        if len(fields) < 5:
            raise ValueError('expected LANE|WORKDIR|SCRATCH|PORT|BRIEF[|BRIEF...]')
        lane, work, scratch, port, *briefs = fields
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', lane) or lane in lanes:
            raise ValueError('invalid/duplicate lane')
        if not re.fullmatch(r'[1-9][0-9]*', port) or not 1024 <= int(port) <= 65535 or int(port) in ports:
            raise ValueError('invalid/duplicate port (no leading zeros)')
        for raw in (work, scratch):
            path = Path(raw)
            if not path.is_absolute() or path.exists():
                raise ValueError('workdir and scratch must be fresh absolute paths')
            resolved = path.resolve()
            if any(resolved == p or resolved in p.parents or p in resolved.parents for p in paths):
                raise ValueError('overlapping lane paths')
            paths.append(resolved)
        if any(not Path(b).is_absolute() or not Path(b).is_file() or not Path(b).stat().st_size for b in briefs):
            raise ValueError('missing/invalid brief')
        lanes.add(lane)
        ports.add(int(port))
        rows.append(line)
    if not rows:
        raise ValueError('empty manifest')
    print('\n'.join(rows))


def seed(source, dest):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if source:
        source = Path(source)
        for name in ('auth.json', 'models.json'):
            path = source / name
            if not path.exists():
                continue
            data = json.loads(path.read_text())
            data = ({'cpa': data['cpa']} if 'cpa' in data else {}) if name == 'auth.json' else {
                'providers': {k: v for k, v in data.get('providers', {}).items() if k == 'cpa'}}
            (dest / name).write_text(json.dumps(data) + '\n')
        config = source / 'pi-cliproxyapi-provider/config.json'
        if config.exists():
            (dest / config.parent.name).mkdir()
            shutil.copyfile(config, dest / config.parent.name / config.name)
    # No inherited settings/packages; no model-catalog downloads or telemetry.
    (dest / 'settings.json').write_text(json.dumps({
        'cacheWarming': 'off', 'enableAnalytics': False, 'enableInstallTelemetry': False,
        'compaction': {'enabled': False}, 'retry': {'enabled': False}}) + '\n')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        if sys.argv[1] == 'validate':
            validate(*sys.argv[2:])
        elif sys.argv[1] == 'seed':
            seed(*sys.argv[2:])
        elif sys.argv[1] == 'result':
            path, lane, code, reason = sys.argv[2:]
            tmp = Path(path + '.tmp')
            tmp.write_text(json.dumps({'lane': lane, 'exit': int(code), 'reason': reason}) + '\n')
            tmp.replace(path)
        else:
            raise ValueError('unknown operation')
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
