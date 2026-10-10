"""Safety and portability checks for the isolated CI database lifecycle."""
import os
import unittest
from unittest.mock import patch

import run_e2e_backend as e2e


class CleanupTests(unittest.TestCase):
    schema = 'bb_e2e_' + 'a1' * 10

    def test_rejects_application_and_injected_schema_names(self):
        for schema in ('training', 'public', 'bb_e2e_user', self.schema + '"; DROP SCHEMA public;--'):
            with self.subTest(schema=schema), patch.object(e2e.shutil, 'which') as which:
                with self.assertRaises(ValueError):
                    e2e.cleanup_command(schema, e2e.DEFAULT_DATABASE_URL)
                which.assert_not_called()

    def test_native_client_targets_configured_database_without_cli_password(self):
        test_url = 'postgres://ci:synthetic-password@127.0.0.1:5432/isolated_ci?sslmode=disable'
        with patch.object(e2e.shutil, 'which', return_value='/usr/bin/psql'):
            command, environment = e2e.cleanup_command(self.schema, test_url)
        self.assertEqual(environment['PGPASSWORD'], 'synthetic-password')
        self.assertEqual(command[command.index('--dbname') + 1],
                         'postgres://ci@127.0.0.1:5432/isolated_ci?sslmode=disable')
        self.assertNotIn(test_url, command)
        self.assertNotIn('synthetic-password', ' '.join(command))
        self.assertIn('--set=ON_ERROR_STOP=1', command)
        self.assertIn('--no-psqlrc', command)
        self.assertEqual(command[-1], 'DROP SCHEMA IF EXISTS "' + self.schema + '" CASCADE')

    def test_encoded_password_and_connection_options_are_preserved(self):
        test_url = 'postgresql://ci:p%40ss%3Aword+123@[::1]:5432/ci%20database?sslmode=require&options=-csearch_path%3Dpublic'
        with patch.object(e2e.shutil, 'which', return_value='/usr/bin/psql'):
            command, environment = e2e.cleanup_command(self.schema, test_url)
        self.assertEqual(environment['PGPASSWORD'], 'p@ss:word+123')
        self.assertEqual(command[command.index('--dbname') + 1],
                         'postgresql://ci@[::1]:5432/ci%20database?sslmode=require&options=-csearch_path%3Dpublic')

    def test_query_password_overrides_userinfo_without_entering_command_line(self):
        test_url = 'postgres://ci:first-secret@localhost/ci?application_name=bodybuilder+ci&password=second%40secret+123&sslmode=disable'
        with patch.object(e2e.shutil, 'which', return_value='/usr/bin/psql'):
            command, environment = e2e.cleanup_command(self.schema, test_url)
        self.assertEqual(environment['PGPASSWORD'], 'second@secret+123')
        self.assertEqual(command[command.index('--dbname') + 1],
                         'postgres://ci@localhost/ci?application_name=bodybuilder+ci&sslmode=disable')
        self.assertNotIn('secret', ' '.join(command))

    def test_native_cleanup_rejects_non_postgresql_connection_uris(self):
        with patch.object(e2e.shutil, 'which', return_value='/usr/bin/psql'):
            with self.assertRaisesRegex(ValueError, 'PostgreSQL connection URI'):
                e2e.cleanup_command(self.schema, 'https://example.test/database')

    def test_compose_fallback_is_limited_to_known_local_database(self):
        def installed(name):
            return '/usr/local/bin/docker' if name == 'docker' else None
        with patch.object(e2e.shutil, 'which', side_effect=installed):
            command, _ = e2e.cleanup_command(self.schema, e2e.DEFAULT_DATABASE_URL)
            self.assertEqual(command[:6], ['docker', 'compose', 'exec', '-T', 'postgres', 'psql'])
            with self.assertRaisesRegex(RuntimeError, 'psql'):
                e2e.cleanup_command(self.schema, 'postgres://ci@127.0.0.1:5432/another_database')

    def test_no_available_client_fails_before_startup(self):
        with patch.object(e2e.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'psql'):
                e2e.cleanup_command(self.schema, e2e.DEFAULT_DATABASE_URL)

    def test_missing_executables_do_not_open_listener_or_database(self):
        with patch.dict(os.environ, {'BODYBUILDER_E2E_BIN_DIR': '/bodybuilder-test-missing-binaries'}):
            with patch.object(e2e.socket, 'socket') as socket, patch.object(e2e, 'cleanup_command') as cleanup:
                with self.assertRaisesRegex(RuntimeError, 'Build the E2E executable'):
                    e2e.main()
                socket.assert_not_called()
                cleanup.assert_not_called()


if __name__ == '__main__':
    unittest.main()
