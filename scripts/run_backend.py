#!/usr/bin/env python3
"""Load local configuration as data and run the Go API (no shell evaluation)."""
import os
from pathlib import Path
import sys

repo = Path(__file__).resolve().parents[1]
environment = os.environ.copy()
local = repo / '.env'
if local.exists():
    for line in local.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        name = name.strip()
        if not name.replace('_', '').isalnum():
            continue
        environment.setdefault(name, value.strip().strip('\"\''))
environment.setdefault('GOCACHE', '/private/tmp/bodybuilder-go-cache')
os.chdir(repo / 'backend')
command = sys.argv[1:] or ['go', 'run', '.']
os.execvpe(command[0], command, environment)
