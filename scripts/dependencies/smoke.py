"""Opt-in real-download smoke runner. Run only in a disposable workspace/container."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / '.cache/toolchain-qa/catalog.json').read_text())
BASE = Path(os.environ.get('SMOKE_HOME', '/data/toolchain-qa'))
BIN = BASE / 'bin'
BIN.mkdir(parents=True, exist_ok=True)
ENV = {**os.environ, 'PATH': str(BIN) + ':' + os.environ['PATH']}


def install(name):
    manifest = CATALOG[name]
    home = BASE / name
    receipt = home / 'smoke-result.json'
    if receipt.is_file():
        return
    if manifest['source'] == 'image' and all(shutil.which(cmd, path=ENV['PATH']) for cmd in manifest['provides']):
        return
    for dependency in manifest.get('requires', []):
        install(dependency)
    home.mkdir(parents=True, exist_ok=True)
    result = BASE / (name + '-result.json')
    operating = 'darwin' if sys.platform == 'darwin' else 'linux'
    arch = 'arm64' if os.uname().machine in ('arm64', 'aarch64') else 'amd64'
    env = {**ENV, 'MEMOH_DEP_HOME': str(home), 'MEMOH_DEP_BIN': str(BIN), 'MEMOH_DEP_ID': name,
           'MEMOH_DEP_RESULT': str(result), 'MEMOH_DEP_VERSION': '', 'MEMOH_DEP_ACTION': 'install',
           'MEMOH_DEP_CURRENT_VERSION': '', 'MEMOH_DEP_OS': operating, 'MEMOH_DEP_ARCH': arch,
           'MEMOH_DEP_LIBC': 'glibc', 'CI': '1', 'DEBIAN_FRONTEND': 'noninteractive'}
    body = (ROOT / 'registries/memoh/dependencies' / name / manifest['scripts']['install']).read_text()
    prelude = '''set -eu
dep_log() { printf '%s\\n' "$*" >&2; }
dep_result() { printf '%s' "$1" > "$MEMOH_DEP_RESULT"; }
dep_switch() { ln -sfn "$1" "$MEMOH_DEP_HOME/current"; }
memoh_dep_main() {
'''
    print('INSTALL', name, flush=True)
    with (BASE / (name + '.log')).open('w') as log:
        child = subprocess.run(['sh', '-s'], input=prelude + body + '\n}\nmemoh_dep_main < /dev/null\n', text=True, env=env, stdout=log, stderr=log)
    if child.returncode:
        print((BASE / (name + '.log')).read_text()[-8000:], file=sys.stderr)
        raise SystemExit(child.returncode)
    data = json.loads(result.read_text())
    for cmd, entrypoint in data['entrypoints'].items():
        shim = BIN / cmd
        shim.unlink(missing_ok=True)
        shim.symlink_to(entrypoint)
    receipt.write_text(json.dumps(data))
    print('PASS', name, data['version'], flush=True)


for name in sys.argv[1:]:
    install(name)
