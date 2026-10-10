#!/usr/bin/env python3
"""Run an isolated live E2E API and remove only its freshly generated schema.

Build bodybuilder-api/bodybuilder-admin into BODYBUILDER_E2E_BIN_DIR first.
Provider traffic is restricted to local stubs; no production .env is loaded.
"""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = 'postgres://training:training@127.0.0.1:5433/training?sslmode=disable'
ADMIN_EMAIL = 'e2e-admin@bodybuilder.test'
ADMIN_PASSWORD = 'BodyBuilder-e2e-admin-42!'
API_URL = 'http://127.0.0.1:8082'

class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.respond()

    def do_GET(self):
        self.respond()

    def respond(self):
        body = b'{"error":{"message":"local test upstream unavailable"}}'
        self.send_response(502)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def cleanup_command(schema, database_url):
    # Reject application schemas and arbitrary SQL before selecting any client.
    if not re.fullmatch(r'bb_e2e_[0-9a-f]{20}', schema):
        raise ValueError('cleanup requires a freshly generated E2E schema name')
    sql = 'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'
    psql = shutil.which('psql')
    if psql:
        environment = os.environ.copy()
        connection = urlsplit(database_url)
        if connection.scheme not in ('postgres', 'postgresql'):
            raise ValueError('TEST_DATABASE_URL must be a PostgreSQL connection URI')
        # psql expands a URI supplied via --dbname, not one in PGDATABASE.
        # Keep its connection options intact, with passwords only in the environment.
        password = unquote(connection.password) if connection.password is not None else None
        netloc = connection.netloc
        if connection.password is not None:
            user_info, host = netloc.rsplit('@', 1)
            netloc = user_info.split(':', 1)[0] + '@' + host
        query = []
        for field in connection.query.split('&') if connection.query else []:
            key, _, value = field.partition('=')
            if unquote(key) == 'password':
                password = unquote(value)
            else:
                query.append(field)
        if password is not None:
            environment['PGPASSWORD'] = password
        environment['PGCONNECT_TIMEOUT'] = '5'
        target = urlunsplit((connection.scheme, netloc, connection.path, '&'.join(query), connection.fragment))
        return [psql, '--no-psqlrc', '--no-password', '--dbname', target,
                '--set=ON_ERROR_STOP=1', '--command', sql], environment
    if database_url == DEFAULT_DATABASE_URL and shutil.which('docker'):
        # Preserve the existing local Compose setup when psql is not on the host.
        return ['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '--no-psqlrc',
                '--no-password', '-U', 'training', '-d', 'training',
                '--set=ON_ERROR_STOP=1', '--command', sql], os.environ.copy()
    raise RuntimeError('Install PostgreSQL client tools (psql) to clean the configured TEST_DATABASE_URL')

def stop(*_):
    raise KeyboardInterrupt

def main():
    bin_dir = Path(os.environ.get('BODYBUILDER_E2E_BIN_DIR', '/private/tmp' if Path('/private/tmp').is_dir() else tempfile.gettempdir()))
    api_binary = bin_dir / 'bodybuilder-api'
    admin_binary = bin_dir / 'bodybuilder-admin'
    for binary in (api_binary, admin_binary):
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeError('Build the E2E executable first: ' + str(binary))
    database_url = os.environ.get('TEST_DATABASE_URL', DEFAULT_DATABASE_URL)
    schema = 'bb_e2e_' + uuid.uuid4().hex[:20]
    cleanup, cleanup_environment = cleanup_command(schema, database_url)
    # A different API already on this port must never receive setup requests.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 8082))
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    upstream = 'http://127.0.0.1:' + str(stub.server_port)
    environment = os.environ.copy()
    environment.update({
        'DATABASE_URL': database_url, 'DB_SCHEMA': schema,
        'PORT': '8082', 'API_HOST': '127.0.0.1',
        'JWT_SECRET': 'isolated-e2e-only-secret-at-least-thirty-two-characters',
        'PROVIDER_ENCRYPTION_KEY': base64.b64encode(bytes([42]) * 32).decode(),
        'OPENAI_API_URL': upstream, 'ANTHROPIC_API_URL': upstream,
        'OPENROUTER_API_URL': upstream, 'FOOD_SEARCH_URL': upstream,
    })
    backend = None
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        backend = subprocess.Popen([str(api_binary)], cwd=REPO / 'backend', env=environment)
        for _ in range(100):
            if backend.poll() is not None:
                raise RuntimeError('isolated API failed to start')
            try:
                with urlopen(API_URL + '/healthz', timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                time.sleep(.1)
        else:
            raise RuntimeError('isolated API health check timed out')
        request = Request(API_URL + '/api/v1/auth/register', data=json.dumps({
            'displayName': 'E2E Administrator', 'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD,
        }).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=5) as response:
            if response.status != 201:
                raise RuntimeError('test administrator registration failed')
            # Authentication tokens intentionally never leave this setup response.
            response.read()
        subprocess.run([str(admin_binary), '-email', ADMIN_EMAIL], env=environment, cwd=REPO / 'backend', check=True)
        print('Isolated E2E API ready at ' + API_URL + ' in schema ' + schema, flush=True)
        exit_code = backend.wait()
        if exit_code:
            raise RuntimeError('isolated API stopped unexpectedly')
    except KeyboardInterrupt:
        pass
    finally:
        # A repeated termination signal must not interrupt database cleanup.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if backend is not None and backend.poll() is None:
            backend.terminate()
            try:
                backend.wait(timeout=10)
            except subprocess.TimeoutExpired:
                backend.kill()
                backend.wait()
        stub.shutdown()
        stub.server_close()
        subprocess.run(cleanup, env=cleanup_environment, cwd=REPO, check=True,
                       stdout=subprocess.DEVNULL, timeout=15)
        print('Removed isolated E2E schema ' + schema, flush=True)


if __name__ == '__main__':
    main()
