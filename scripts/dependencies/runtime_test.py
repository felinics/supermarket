"""Offline regression checks for version publication and untrusted downloads."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import shutil
import sys
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('recipe', Path(__file__).with_name('runtime.py'))
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / 'dependency'
        self.old = self.home / 'versions' / 'old'
        (self.old / 'bin').mkdir(parents=True)
        (self.old / 'bin' / 'tool').write_text('old working tool')
        (self.home / 'current').symlink_to(self.old)
        self.result = self.root / 'result.json'
        env = {'MEMOH_DEP_HOME': str(self.home), 'MEMOH_DEP_RESULT': str(self.result),
               'MEMOH_DEP_OS': 'linux', 'MEMOH_DEP_ARCH': 'arm64', 'MEMOH_DEP_LIBC': 'glibc'}
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, env).start()
        self.config = {'supported': ['linux/arm64'], 'commands': ['tool']}
        patch.object(recipe, 'resolve', return_value={'version': '2.0.0'}).start()

    def installed(self, config, resolution, target, home):
        (target / 'bin').mkdir()
        (target / 'bin' / 'tool').write_text('new working tool')

    def assert_old_survives(self):
        self.assertEqual((self.home / 'current').resolve(), self.old)
        self.assertEqual((self.old / 'bin' / 'tool').read_text(), 'old working tool')
        self.assertEqual(list((self.home / 'versions').iterdir()), [self.old])
        self.assertEqual(list(self.home.glob('current-*')), [])

    def test_isolated_install_waits_for_server_publication(self):
        store = self.root / 'local' / 'tool'
        target = store / 'installs' / 'one'
        operation = self.root / 'operation'
        operation.mkdir()
        env = {'MEMOH_DEP_STORE': str(store), 'MEMOH_DEP_INSTALL_DIR': str(target),
               'MEMOH_DEP_OPERATION_DIR': str(operation)}
        with patch.dict(os.environ, env), patch.object(recipe, 'install', side_effect=self.installed):
            recipe.main(self.config, 'install')
            self.assertEqual((operation / 'candidate').read_text(), str(target))
            self.assertEqual((self.home / 'current').resolve(), self.old)
            self.assertTrue((target / 'bin' / 'tool').is_file())
            with self.assertRaises(FileExistsError):
                recipe.main(self.config, 'install')
            recipe.main(self.config, 'remove')
            self.assertTrue(target.is_dir())
            self.assertEqual((self.home / 'current').resolve(), self.old)

    def test_isolated_failure_removes_only_its_candidate(self):
        store = self.root / 'local' / 'tool'
        target = store / 'installs' / 'one'
        with patch.dict(os.environ, {'MEMOH_DEP_STORE': str(store), 'MEMOH_DEP_INSTALL_DIR': str(target)}), \
                patch.object(recipe, 'install', side_effect=RuntimeError('download failed')):
            with self.assertRaises(RuntimeError):
                recipe.main(self.config, 'install')
        self.assertFalse(target.exists())
        self.assert_old_survives()

    def test_frozen_version_probe_rejects_broken_command(self):
        (self.old / 'resolution.json').write_text('{"version":"1.0.0"}')
        with patch.dict(os.environ, {'MEMOH_DEP_CANDIDATE': str(self.old / 'bin' / 'tool')}), \
                patch.object(recipe, 'probe', side_effect=RuntimeError('missing loader')):
            with self.assertRaises(RuntimeError):
                recipe.main(self.config, 'version')
        self.assertFalse(self.result.exists())

    def test_failed_install_preserves_published_version(self):
        with patch.object(recipe, 'install', side_effect=RuntimeError('download or probe failed')):
            with self.assertRaises(RuntimeError):
                recipe.main(self.config, 'install')
        self.assert_old_survives()

    def test_failed_result_write_preserves_published_version(self):
        self.result.mkdir()
        with patch.object(recipe, 'install', side_effect=self.installed):
            with self.assertRaises(IsADirectoryError):
                recipe.main(self.config, 'install')
        self.assert_old_survives()

    def test_failed_switch_preserves_published_version(self):
        with patch.object(recipe, 'install', side_effect=self.installed), patch.object(recipe.os, 'replace', side_effect=OSError('failed rename')):
            with self.assertRaises(OSError):
                recipe.main(self.config, 'install')
        self.assert_old_survives()

    def test_success_uses_permanent_prefix_and_retains_old_version(self):
        with patch.object(recipe, 'install', side_effect=self.installed):
            recipe.main(self.config, 'install')
        result = json.loads(self.result.read_text())
        self.assertEqual(Path(result['entrypoints']['tool']).read_text(), 'new working tool')
        self.assertTrue(self.old.exists())
        self.assertEqual(json.loads(((self.home / 'current') / 'resolution.json').read_text())['version'], '2.0.0')

    def test_unsupported_platform_does_not_resolve_or_mutate(self):
        with patch.dict(os.environ, {'MEMOH_DEP_LIBC': 'musl'}):
            with self.assertRaisesRegex(ValueError, 'Unsupported platform'):
                recipe.main(self.config, 'install')
        recipe.resolve.assert_not_called()
        self.assert_old_survives()

    def test_update_check_never_installs(self):
        with patch.object(recipe, 'install') as installer, patch.dict(os.environ, {'MEMOH_DEP_CURRENT_VERSION': '1.0.0'}):
            recipe.main(self.config, 'check_update')
        installer.assert_not_called()
        self.assertTrue(json.loads(self.result.read_text())['update_available'])
        self.assert_old_survives()

    def test_bundle_repair_uses_validated_exact_resolution_offline(self):
        patch.stopall()
        config = {'backend': 'npm', 'packages': ['a', 'b']}
        exact = recipe.package_resolution(config, {'a': '1.2.3', 'b': '4.5.6'})
        saved = self.home / 'resolutions' / (exact['version'] + '.json')
        saved.parent.mkdir()
        saved.write_text(json.dumps(exact))
        with patch.object(recipe, 'remote_json', side_effect=AssertionError('unexpected network')):
            self.assertEqual(recipe.resolve(config, exact['version'], self.home), exact)
            for changed in [
                {**exact, 'packages': {'a': '9.0.0', 'b': '4.5.6'}},
                {**exact, 'packages': {'a': '1.2.3', 'foreign': '4.5.6'}},
                {**exact, 'version': '0.0.0+invalid'},
            ]:
                saved.write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError, 'approved'):
                    recipe.resolve(config, exact['version'], self.home)

    def test_debian_resolution_keeps_apt_cache_in_the_local_store(self):
        patch.stopall()
        store = self.root / 'local-store'
        with patch.dict(os.environ, {'MEMOH_DEP_OS': 'linux'}), \
                patch.object(recipe, 'run'), patch.object(recipe, 'capture', return_value='Candidate: 4:24.2.7-0ubuntu0.24.04.4'):
            resolved = recipe.resolve({'backend': 'libreoffice'}, '', self.home, store)
        self.assertEqual(resolved['version'], '4_24.2.7-0ubuntu0.24.04.4')
        self.assertTrue((store / 'cache' / 'apt' / 'status').exists())
        self.assertFalse((self.home / 'cache').exists())

    def test_bundle_version_probe_detects_missing_declared_imports(self):
        for backend in ['npm', 'python']:
            with self.subTest(backend=backend):
                root = self.root / backend
                module_name = 'memoh_probe_module'
                command = 'document-node' if backend == 'npm' else 'document-python'
                config = {**self.config, 'backend': backend, 'packages': [module_name],
                          'commands': [command], 'imports': [module_name]}
                if backend == 'npm':
                    node = shutil.which('node')
                    if not node:
                        self.skipTest('Node.js is required for the actual module health probe')
                    module = root / 'modules' / module_name / 'index.js'
                    module.parent.mkdir(parents=True)
                    module.write_text('module.exports = true;\n')
                    recipe.wrapper(root / 'bin' / command, node, {'NODE_PATH': str(root / 'modules')})
                else:
                    module = root / 'modules' / (module_name + '.py')
                    module.parent.mkdir(parents=True)
                    module.write_text('value = True\n')
                    recipe.wrapper(root / 'venv' / 'bin' / 'python', sys.executable,
                                   {'PYTHONPATH': str(root / 'modules'), 'PYTHONDONTWRITEBYTECODE': '1'})
                    recipe.wrapper(root / 'bin' / command, root / 'venv' / 'bin' / 'python')
                (root / 'resolution.json').write_text(json.dumps({'version': '1.0.0', 'packages': {module_name: '1.0.0'}}))
                with patch.dict(os.environ, {'MEMOH_DEP_CANDIDATE': str(root / 'bin' / command)}):
                    recipe.main(config, 'version')
                    self.assertEqual(json.loads(self.result.read_text())['version'], '1.0.0')
                    module.unlink()
                    self.result.unlink()
                    with self.assertRaises(subprocess.CalledProcessError):
                        recipe.main(config, 'version')
                    self.assertFalse(self.result.exists())

    def test_archive_traversal_cannot_write_outside_candidate(self):
        archive = self.root / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('../escaped', 'bad')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            recipe.unpack(archive, self.root / 'candidate')
        self.assertFalse((self.root / 'escaped').exists())

    def test_debian_office_configuration_is_registered_inside_private_root(self):
        root = self.root / 'office'
        office = root / 'usr/lib/libreoffice'
        (office / 'share/.registry').mkdir(parents=True)
        (office / 'share/.registry/main.xcd').write_text('default schema')
        (office / 'share/registry').symlink_to('/etc/libreoffice/registry')
        (office / 'program').mkdir()
        (office / 'program/fundamentalrc').write_text('BRAND_BASE_DIR=file:///usr/lib/libreoffice\nCONFIGURATION_LAYERS=xcsxcu:file:///etc/libreoffice/registry')
        recipe.relocate_libreoffice(root)
        self.assertEqual((office / 'share/registry/main.xcd').read_text(), 'default schema')
        self.assertEqual((office / 'share/registry').resolve(), root / 'etc/libreoffice/registry')
        config = (office / 'program/fundamentalrc').read_text()
        self.assertNotIn('file:///usr/', config)
        self.assertIn(root.as_uri() + '/etc/libreoffice/registry', config)

    def test_office_launcher_restarts_profile_initialization_once(self):
        executable = self.root / 'fake office'
        executable.write_text('#!/bin/sh\nif [ ! -f "$1" ]; then touch "$1"; exit 81; fi\nprintf "%s" "$2"\n')
        executable.chmod(0o755)
        launcher = self.root / 'launcher'
        recipe.wrapper(launcher, executable, restart_once=True)
        result = subprocess.run([str(launcher), str(self.root / 'profile marker'), 'argument with spaces'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'argument with spaces')
        executable.write_text('#!/bin/sh\necho attempt >> "$1"\nexit 81\n')
        attempts = self.root / 'attempts'
        result = subprocess.run([str(launcher), str(attempts)])
        self.assertEqual(result.returncode, 81)
        self.assertEqual(len(attempts.read_text().splitlines()), 2)

    def test_checksum_failure_discards_download(self):
        destination = self.root / 'download'
        with patch.object(recipe.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt')):
            with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                recipe.download('https://example.test/archive', destination, '0' * 64)
        self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main()
