"""Opt-in download smoke for the five isolated recipes; never uses a user home.

Example:
  python3 scripts/dependencies/agent-storage-smoke.py --versions \
    node=24.4.1,uv=0.11.8,python=3.13.2,codex=0.154.0,claude-code=2.1.270 \
    --simulate-store-loss

This checks real recipe downloads and relocation. It does not replace the
Memoh API authorization, transaction, workspace-rebuild or UI integration tests.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import time

ORDER = ['node', 'uv', 'python', 'codex', 'claude-code']
COMMANDS = {'node': ['node', 'npm', 'npx'], 'uv': ['uv', 'uvx'],
            'python': ['python3', 'pip3'], 'codex': ['codex'], 'claude-code': ['claude']}
REPO = Path(__file__).resolve().parents[2]
PRELUDE = '''set -eu
dep_log() { printf '%s\\n' "$*" >&2; }
dep_result() { printf '%s' "$1" > "$MEMOH_DEP_RESULT"; }
dep_switch() { printf '%s' "$1" > "$SMOKE_CANDIDATE"; }
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--versions', required=True)
    parser.add_argument('--simulate-store-loss', action='store_true')
    parser.add_argument('--extra-versions', default='', help='Optional generated recipes, for example pnpm=12.4.1')
    args = parser.parse_args()
    versions = dict(item.split('=', 1) for item in args.versions.split(','))
    if set(versions) != set(ORDER) or any(not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?', v) for v in versions.values()):
        parser.error('--versions must give one exact version for all five dependencies')
    order = list(ORDER)
    commands = dict(COMMANDS)
    if args.extra_versions:
        for item in args.extra_versions.split(','):
            dep, version = item.split('=', 1)
            if dep in commands or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', dep) or not re.fullmatch(r'[0-9][0-9A-Za-z.+_-]{0,99}', version):
                parser.error('invalid or duplicate generated dependency version')
            source = REPO / 'registries/memoh/dependencies' / dep / 'install.sh'
            declaration = next((line for line in source.read_text().splitlines() if line.startswith('CONFIG = json.loads(')), '')
            if not declaration.endswith(')'):
                parser.error('extra dependency must use the generated runtime')
            config = json.loads(json.loads(declaration[len('CONFIG = json.loads('):-1]))
            commands[dep] = config['commands']
            versions[dep] = version
            order.append(dep)
    system = platform.system().lower()
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine())
    if system not in ('linux', 'darwin') or arch is None:
        parser.error('unsupported smoke platform')
    root = Path(tempfile.mkdtemp(prefix='memoh-agent-storage-smoke-')).resolve()
    persistent = root / 'persistent'
    store_root = root / 'rootfs' / 'deps'
    persistent.mkdir()
    (persistent / 'home').mkdir()
    (persistent / 'home' / '.codex').mkdir()
    (persistent / 'home' / '.claude').mkdir()
    sentinel = persistent / 'home' / 'persistent-state'
    sentinel.write_text('must survive dependency install, removal and store loss\n')
    shim_root = persistent / 'bin'
    shim_root.mkdir()
    base_env = {**os.environ, 'HOME': str(persistent / 'home'), 'CODEX_HOME': str(persistent / 'home' / '.codex'),
                'CLAUDE_CONFIG_DIR': str(persistent / 'home' / '.claude'), 'CI': '1',
                'PATH': str(shim_root) + os.pathsep + os.environ['PATH'],
                'MEMOH_DEP_OS': system, 'MEMOH_DEP_ARCH': arch, 'MEMOH_DEP_LIBC': 'glibc'}
    report = {'root': str(root), 'versions': versions, 'platform': f'{system}/{arch}', 'runs': []}
    print(f'Smoke artifacts: {root}', flush=True)
    for generation in range(2 if args.simulate_store_loss else 1):
        if generation:
            # The root is allocated by this process, and only this disposable
            # directory is destroyed. Persistent homes and shims stay in place.
            shutil.rmtree(root / 'rootfs')
            assert sentinel.read_text().startswith('must survive')
            assert all(not (shim_root / commands[dep][0]).exists() for dep in order)
        for dep in order:
            home = persistent / 'deps' / dep
            home.mkdir(parents=True, exist_ok=True)
            store = store_root / dep
            candidate = store / 'installs' / f'operation-{generation}'
            operation = root / f'{generation}-{dep}'
            operation.mkdir()
            env = {**base_env, 'MEMOH_DEP_ID': dep, 'MEMOH_DEP_VERSION': versions[dep],
                   'MEMOH_DEP_HOME': str(home), 'MEMOH_DEP_STORE': str(store),
                   'MEMOH_DEP_INSTALL_DIR': str(candidate), 'MEMOH_DEP_STAGING': str(store / f'.staging-{generation}'),
                   'MEMOH_DEP_RESULT': str(operation / 'result.json'), 'SMOKE_CANDIDATE': str(operation / 'candidate'),
                   'MEMOH_DEP_OPERATION_DIR': str(operation)}
            recipe = (REPO / 'registries/memoh/dependencies' / dep / 'install.sh').read_text()
            started = time.monotonic()
            with (operation / 'install.log').open('w') as output:
                subprocess.run(['/bin/sh', '-s'], input=PRELUDE + recipe, text=True,
                               env=env, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=1200)
            elapsed = time.monotonic() - started
            assert (operation / 'candidate').read_text() == str(candidate)
            result = json.loads((operation / 'result.json').read_text())
            assert result['version'] == versions[dep]
            current = home / 'current'
            assert not current.exists(), 'recipe must defer publication to the runner'
            current.unlink(missing_ok=True)
            current.symlink_to(candidate)
            probes = {}
            for command in commands[dep]:
                entry = Path(result['entrypoints'][command])
                assert entry == current / 'bin' / command
                shim = shim_root / command
                shim.unlink(missing_ok=True)
                shim.symlink_to(entry)
                probes[command] = subprocess.check_output([str(shim), '--version'], env=base_env, text=True, timeout=30).strip()
            health_recipe = REPO / 'registries/memoh/dependencies' / dep / 'version.sh'
            if health_recipe.exists():
                health_result = operation / 'health.json'
                health_env = {**env, 'MEMOH_DEP_RESULT': str(health_result),
                              'MEMOH_DEP_CANDIDATE': str(candidate / 'bin' / commands[dep][0])}
                with (operation / 'health.log').open('w') as output:
                    subprocess.run(['/bin/sh', '-s'], input=PRELUDE + health_recipe.read_text(), text=True,
                                   env=health_env, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=120)
                assert json.loads(health_result.read_text())['version'] == versions[dep]
            assert not (home / 'cache').exists()
            assert not (home / 'versions').exists()
            assert sentinel.read_text().startswith('must survive')
            report['runs'].append({'generation': generation, 'dependency': dep, 'elapsed_seconds': elapsed, 'probes': probes})
            (root / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(f'PASS generation={generation} {dep} {versions[dep]} {elapsed:.2f}s', flush=True)
    print(f'PASS report: {root / "report.json"}', flush=True)


if __name__ == '__main__':
    main()
