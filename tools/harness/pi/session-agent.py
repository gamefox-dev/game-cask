#!/usr/bin/env python3
"""Per-attempt pi configuration; never write to the source/global agent directory."""
import json
import os
from pathlib import Path
import shutil
import sys


def setup(dest, mode):
    if mode not in ('only', 'on', 'off'):
        raise ValueError('PI_CODEMODE must be only, on or off')
    source = Path(os.environ.get('PI_CODING_AGENT_DIR', str(Path.home() / '.pi/agent')))
    dest = Path(dest)
    dest.mkdir(mode=0o700)
    for name in ('auth.json', 'models.json', 'pi-cliproxyapi-provider/config.json'):
        path = source / name
        if path.is_file():
            (dest / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest / name)
            (dest / name).chmod(0o600)
    settings = {'cacheWarming': 'off', 'enableAnalytics': False, 'enableInstallTelemetry': False,
                'compaction': {'enabled': False}, 'retry': {'enabled': False},
                'defaultTools': ['-codemode' if mode == 'off' else '+codemode'],
                'codemode': {'mode': 'only' if mode == 'only' else 'on'}}
    (dest / 'settings.json').write_text(json.dumps(settings) + '\n')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        setup(*sys.argv[1:])
    except (OSError, ValueError) as error:
        sys.exit(str(error))
