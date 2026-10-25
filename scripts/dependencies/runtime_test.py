"""Offline regression checks for version publication and untrusted downloads."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
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

    def test_bundle_rollback_uses_saved_exact_resolution_offline(self):
        patch.stopall()
        saved = self.home / 'resolutions' / '0.0.0+abcd.json'
        saved.parent.mkdir()
        exact = {'version': '0.0.0+abcd', 'packages': {'a': '1.2.3', 'b': '4.5.6'}}
        saved.write_text(json.dumps(exact))
        with patch.object(recipe, 'remote_json', side_effect=AssertionError('unexpected network')):
            self.assertEqual(recipe.resolve({'backend': 'npm', 'packages': ['a', 'b']}, '0.0.0+abcd', self.home), exact)

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


class VersionTests(unittest.TestCase):
    config = {'backend': 'github', 'repo': 'mamba-org/micromamba-releases',
              'tag_prefix': '', 'tag_build_suffix': True}

    def test_micromamba_release_and_legacy_install_versions(self):
        for tag in ('2.9.0-0', '2.9.0-12'):
            with self.subTest(tag=tag), patch.object(recipe, 'remote_json', return_value={'tag_name': tag, 'assets': ['original']}):
                resolution = recipe.resolve(self.config, '', Path('/unused'))
                self.assertEqual(resolution['version'], '2.9.0')
                self.assertEqual(resolution['release']['tag_name'], tag)
                self.assertEqual(resolution['release']['assets'], ['original'])
                self.assertFalse(recipe.newer(resolution['version'], '2.9.0', self.config))
                self.assertFalse(recipe.newer(resolution['version'], tag, self.config))
        self.assertTrue(recipe.newer('2.10.0', '2.9.0-0', self.config))
        self.assertFalse(recipe.newer('2.9.0', '2.10.0', self.config))

    def test_software_pin_selects_highest_build_across_pages(self):
        pages = [[{'tag_name': '2.9.0-2'}] + [{'tag_name': '1.0.0-0'}] * 99,
                 [{'tag_name': '2.9.0-10'}, {'tag_name': '2.9.0-99', 'draft': True}]]
        with patch.object(recipe, 'remote_json', side_effect=pages) as remote:
            result = recipe.resolve(self.config, '2.9.0', Path('/unused'))
        self.assertEqual(result['version'], '2.9.0')
        self.assertEqual(result['release']['tag_name'], '2.9.0-10')
        self.assertIn('page=2', remote.call_args.args[0])

    def test_explicit_build_pin_retains_exact_release(self):
        with patch.object(recipe, 'remote_json', return_value={'tag_name': '2.9.0-0'}) as remote:
            self.assertEqual(recipe.resolve(self.config, '2.9.0-0', Path('/unused'))['version'], '2.9.0')
        self.assertTrue(remote.call_args.args[0].endswith('/tags/2.9.0-0'))
        with patch.object(recipe, 'remote_json', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'No release'):
                recipe.resolve(self.config, '2.8.0', Path('/unused'))

    def test_release_order_and_metadata(self):
        for newer, older in [('2.9.0', '2.9.0-rc.1'), ('2.9.0-rc.10', '2.9.0-rc.2'),
                             ('2.9.0-beta', '2.9.0-1'), ('25.2.3.2', '25.2.3.1'), ('2.10.0', '2.9.9')]:
            with self.subTest(newer=newer, older=older):
                self.assertTrue(recipe.newer(newer, older))
                self.assertFalse(recipe.newer(older, newer))
        for left, right in [('2.9.0', '2.9'), ('2.9.0+build1', '2.9.0+build2')]:
            self.assertFalse(recipe.newer(left, right))
            self.assertFalse(recipe.newer(right, left))
        self.assertEqual(recipe.software_version({}, '2.9.0-1'), '2.9.0-1')
        self.assertTrue(recipe.newer('0.0.0+abc', '0.0.0+def', {'packages': ['a', 'b']}))
        self.assertFalse(recipe.newer('0.0.0+abc', '0.0.0+abc', {'packages': ['a', 'b']}))

    def test_debian_comparison_uses_package_version_rules(self):
        with patch.dict(os.environ, {'MEMOH_DEP_OS': 'linux'}), patch.object(recipe.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            self.assertFalse(recipe.newer('4_25.2.3-2', '4_25.2.3-10', {'backend': 'libreoffice'}))
        self.assertEqual(run.call_args.args[0], ['dpkg', '--compare-versions', '4:25.2.3-2', 'gt', '4:25.2.3-10'])


class CondaResolutionTests(unittest.TestCase):
    @staticmethod
    def file(version, subdir='linux-64', labels=None, **extra):
        return {'version': version, 'type': 'conda', 'basename': f'{subdir}/qpdf-{version}-0.conda',
                'attrs': {'subdir': subdir}, 'labels': ['main'] if labels is None else labels, **extra}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'qpdf'
        self.result = Path(self.temp.name) / 'result.json'
        env = {'MEMOH_DEP_HOME': str(self.home), 'MEMOH_DEP_RESULT': str(self.result),
               'MEMOH_DEP_OS': 'linux', 'MEMOH_DEP_ARCH': 'amd64', 'MEMOH_DEP_LIBC': 'glibc',
               'MEMOH_DEP_VERSION': '', 'MEMOH_DEP_CURRENT_VERSION': '12.4.1'}
        environment = patch.dict(os.environ, env)
        environment.start()
        self.addCleanup(environment.stop)
        self.config = {'backend': 'conda', 'package': 'qpdf', 'commands': ['qpdf'],
                       'supported': ['linux/amd64', 'linux/arm64', 'darwin/arm64']}
        self.data = {'latest_version': '12.4.2', 'files': [
            self.file('12.4.1'), self.file('12.4.2', 'linux-aarch64'), self.file('12.4.2', 'osx-arm64'),
            self.file('12.5.0', labels=['dev']), self.file('99.0', 'win-64'),
            self.file('98.0', type='source'), self.file('97.0', labels=[]),
        ]}
        metadata = patch.object(recipe, 'remote_json', return_value=self.data)
        self.metadata = metadata.start()
        self.addCleanup(metadata.stop)

    def test_latest_uses_target_architecture_and_main_label(self):
        for operating, arch, expected in [('linux', 'amd64', '12.4.1'),
                                           ('linux', 'arm64', '12.4.2'), ('darwin', 'arm64', '12.4.2')]:
            with self.subTest(platform=(operating, arch)), patch.dict(os.environ, {'MEMOH_DEP_OS': operating, 'MEMOH_DEP_ARCH': arch}):
                self.assertEqual(recipe.resolve(self.config, '', self.home), {'version': expected})
        self.metadata.assert_called_with('https://api.anaconda.org/package/conda-forge/qpdf')

    def test_noarch_and_legacy_basename_metadata_are_available(self):
        self.data['files'].append(self.file('12.4.3', 'noarch', attrs={}))
        self.assertEqual(recipe.resolve(self.config, 'latest', self.home)['version'], '12.4.3')

    def test_numeric_version_order_is_independent_of_upload_order(self):
        self.data['files'] = [self.file('12.10.0'), self.file('12.9.0'), self.file('12.2.0')]
        self.assertEqual(recipe.resolve(self.config, 'stable', self.home)['version'], '12.10.0')

    def test_prerelease_requires_an_explicit_request(self):
        self.data['files'].append(self.file('13.0.0rc1'))
        self.assertEqual(recipe.resolve(self.config, '', self.home)['version'], '12.4.1')
        self.assertEqual(recipe.resolve(self.config, '13.0.0rc1', self.home)['version'], '13.0.0rc1')

    def test_explicit_available_version_is_preserved(self):
        self.data['files'].append(self.file('12.3.2'))
        self.assertEqual(recipe.resolve(self.config, '12.3.2', self.home)['version'], '12.3.2')

    def test_explicit_unavailable_version_fails_before_install_or_publication(self):
        with patch.dict(os.environ, {'MEMOH_DEP_VERSION': '12.4.2'}), patch.object(recipe, 'install') as installer:
            with self.assertRaisesRegex(ValueError, 'qpdf 12.4.2.*linux-64'):
                recipe.main(self.config, 'install')
        installer.assert_not_called()
        self.assertFalse(self.home.exists())
        self.assertFalse(self.result.exists())

    def test_missing_target_builds_do_not_fall_back_to_global_latest(self):
        self.data['files'] = [self.file('12.4.2', 'linux-aarch64')]
        with self.assertRaisesRegex(ValueError, 'No stable qpdf.*linux-64'):
            recipe.resolve(self.config, '', self.home)

    def test_check_update_does_not_advertise_other_architectures(self):
        with patch.object(recipe, 'install') as installer:
            recipe.main(self.config, 'check_update')
        installer.assert_not_called()
        self.assertEqual(json.loads(self.result.read_text()),
                         {'installed': '12.4.1', 'latest': '12.4.1', 'update_available': False})
        self.assertFalse((self.home / 'current').exists())
        self.assertFalse((self.home / 'versions').exists())

    def test_install_uses_resolved_version_and_platform_despite_ambient_override(self):
        target = self.home / 'versions' / 'candidate'
        target.mkdir(parents=True)
        resolution = recipe.resolve(self.config, '', self.home)
        with patch.dict(os.environ, {'CONDA_SUBDIR': 'osx-arm64'}), patch.object(recipe, 'run') as runner:
            recipe.install(self.config, resolution, target, self.home)
        args = runner.call_args_list[0].args[0]
        self.assertEqual(args[args.index('--platform') + 1], 'linux-64')
        self.assertEqual(args[args.index('--channel') + 1], 'conda-forge')
        self.assertIn('qpdf=12.4.1', args)


if __name__ == '__main__':
    unittest.main()
