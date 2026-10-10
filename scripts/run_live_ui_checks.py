#!/usr/bin/env python3
"""Run live development/production checks with an owned API and guaranteed cleanup."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[1]


def stop(*_):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports-dir', type=Path, default=REPO / 'frontend' / 'ci-artifacts' / 'live')
    args = parser.parse_args()
    reports = args.reports_dir.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    log_path = reports / 'api.log'
    environment = os.environ.copy()
    environment.update({
        'E2E_ADMIN_EMAIL': 'e2e-admin@bodybuilder.test',
        'E2E_ADMIN_PASSWORD': 'BodyBuilder-e2e-admin-42!',
        'BACKEND_API_URL': 'http://127.0.0.1:8082',
    })
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with log_path.open('w') as log:
        backend = subprocess.Popen([sys.executable, str(REPO / 'scripts' / 'run_e2e_backend.py')],
                                   cwd=REPO, env=environment, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while 'Isolated E2E API ready at ' not in log_path.read_text():
                if backend.poll() is not None:
                    raise RuntimeError('E2E setup failed; see ' + str(log_path))
                if time.monotonic() > deadline:
                    raise RuntimeError('E2E setup timed out; see ' + str(log_path))
                time.sleep(.1)
            suites = [
                ('development', ['npm', 'run', 'test:live', '--']),
                ('production', ['npm', 'run', 'test:live:production', '--',
                                'tests/live/nutrition.spec.ts', 'tests/live/offline.spec.ts']),
            ]
            for name, command in suites:
                suite_dir = reports / name
                environment['PLAYWRIGHT_HTML_OUTPUT_DIR'] = str(suite_dir / 'report')
                subprocess.run(command + ['--output', str(suite_dir / 'results')],
                               cwd=REPO / 'frontend', env=environment, check=True)
                if backend.poll() is not None:
                    raise RuntimeError('E2E API stopped during browser tests; see ' + str(log_path))
        finally:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            if backend.poll() is None:
                backend.terminate()
            try:
                exit_code = backend.wait(timeout=30)
            except subprocess.TimeoutExpired:
                backend.kill()
                backend.wait()
                raise RuntimeError('E2E cleanup timed out; see ' + str(log_path))
            if exit_code:
                raise RuntimeError('E2E setup/cleanup failed; see ' + str(log_path))


if __name__ == '__main__':
    main()
