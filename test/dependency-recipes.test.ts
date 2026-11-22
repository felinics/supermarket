import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const recipes = ['node', 'uv', 'python', 'codex', 'claude-code', 'grok', 'antigravity'] as const
const version = '3.14.2'
const scripts = path.resolve(import.meta.dirname, '../registries/memoh/dependencies')

async function executable(file: string, body: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `#!/bin/sh\nset -eu\n${body}\n`)
  await chmod(file, 0o755)
}

async function fixture(id: typeof recipes[number]) {
  const root = await mkdtemp(path.join(tmpdir(), 'dependency-recipe-'))
  roots.push(root)
  const home = path.join(root, 'dependency')
  const bin = path.join(root, 'bin')
  const old = path.join(home, 'versions', version)
  await mkdir(old, { recursive: true })
  await writeFile(path.join(old, 'marker'), 'old working copy')
  await symlink(old, path.join(home, 'current'))
  const archiveRoot = path.join(root, 'payload')
  await mkdir(archiveRoot)
  for (const command of id === 'node' ? ['node', 'npm', 'npx'] : ['uv', 'uvx']) {
    await executable(path.join(archiveRoot, ...(id === 'node' ? ['bin'] : []), command),
      `printf '%s\\n' '${id === 'node' ? 'v' : 'uv '}${version}'`)
  }
  if (id === 'antigravity') {
    await executable(path.join(archiveRoot, 'antigravity'), `
[ "\${FAIL_NATIVE:-}" != 1 ] || exit 17
if [ "\${1:-}" = --version ]; then
  printf '${version}\\n'
else
  printf 'auto_update_disabled=%s\\n' "\${AGY_CLI_DISABLE_AUTO_UPDATE:-unset}"
  printf 'arg=%s\\n' "$@"
fi`)
  }
  await writeFile(path.join(archiveRoot, 'marker'), 'new working copy')
  const archive = path.join(root, 'archive.tar.gz')
  const packed = spawnSync('tar', ['-czf', archive, '-C', id === 'antigravity' ? archiveRoot : root,
    id === 'antigravity' ? 'antigravity' : 'payload'])
  expect(packed.status).toBe(0)
  const archiveBytes = await readFile(archive)
  const digest = createHash('sha256').update(archiveBytes).digest('hex')
  await executable(path.join(bin, 'curl'), `
[ "\${FAIL_DOWNLOAD:-}" != 1 ] || exit 9
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/downloads"
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift ;;
    *) url="$1" ;;
  esac
  shift
done
case "$url" in
  https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest|https://api.github.com/repos/google-antigravity/antigravity-cli/releases/tags/*)
    [ "\${FAIL_RELEASE:-}" != 1 ] || exit 22
    case "$MEMOH_DEP_OS/$MEMOH_DEP_ARCH/\${MEMOH_DEP_LIBC:-}" in
      linux/amd64/musl) asset_platform=linux_x64_musl ;;
      linux/arm64/musl) asset_platform=linux_arm64_musl ;;
      linux/amd64/*) asset_platform=linux_x64 ;;
      linux/arm64/*) asset_platform=linux_arm64 ;;
      darwin/amd64/*) asset_platform=mac_x64 ;;
      darwin/arm64/*) asset_platform=mac_arm64 ;;
      *) exit 8 ;;
    esac
    release_version="\${url##*/}"
    if [ "$release_version" = latest ]; then release_version="$FIXTURE_LATEST"; fi
    release_version="\${FIXTURE_RELEASE_TAG:-$release_version}"
    asset="agy_cli_$asset_platform.tar.gz"
    archive_url="\${FIXTURE_ARCHIVE_URL:-https://github.com/google-antigravity/antigravity-cli/releases/download/$release_version/$asset}"
    release="\${FIXTURE_RELEASE_BODY:-}"
    if [ -z "$release" ]; then
      release=$(printf '{"tag_name":"%s","draft":false,"prerelease":false,"assets":[{"name":"%s","state":"uploaded","browser_download_url":"%s","digest":"sha256:%s"}]}' \\
        "$release_version" "$asset" "$archive_url" "$FIXTURE_DIGEST")
    fi
    if [ -n "$output" ]; then printf '%s\\n' "$release" > "$output"; else printf '%s\\n' "$release"; fi
    ;;
  */latest) printf '%s/releases/tag/%s' 'https://github.com/astral-sh/uv' "$FIXTURE_VERSION" ;;
  */index.json) printf '[{"version":"v%s","lts":"Example"}]\\n' "$FIXTURE_LATEST" > "$output" ;;
  */SHASUMS256.txt) printf '%s  node-v%s-darwin-arm64.tar.gz\\n' "$FIXTURE_DIGEST" "$FIXTURE_VERSION" > "$output" ;;
  *.sha256) printf '%s\\n' "$FIXTURE_DIGEST" > "$output" ;;
  *.tar.gz) [ "\${FAIL_ARCHIVE:-}" != 1 ] || exit 22; cp "$FIXTURE_ROOT/archive.tar.gz" "$output" ;;
  */stable) printf '%s\\n' "$FIXTURE_LATEST" ;;
  */grok-*.gz) exit 22 ;;
  */grok-*)
    printf '#!/bin/sh\\nprintf "grok %s\\\\n"\\n' "$FIXTURE_VERSION" > "$output"
    printf 'new working copy' > "$(dirname "$output")/../marker"
    ;;
  *) exit 8 ;;
esac`)
  await executable(path.join(bin, 'npm'), `
case "$1" in
  view) [ "\${FAIL_DOWNLOAD:-}" != 1 ] || exit 9; printf '%s\\n' "$FIXTURE_LATEST" ;;
  --version) printf '11.19.0\\n' ;;
  install)
    [ "\${FAIL_DOWNLOAD:-}" != 1 ] || exit 9
    ignored=false
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --prefix) prefix="$2"; shift ;;
        --ignore-scripts) ignored=true ;;
      esac
      shift
    done
    if [ "$ignored" != true ]; then touch "$FIXTURE_ROOT/postinstall-ran"; exit 18; fi
    mkdir -p "$npm_config_cache"
    printf cached > "$npm_config_cache/archive"
    mkdir -p "$prefix/bin"
    printf 'new working copy' > "$prefix/marker"
    if [ "$MEMOH_DEP_ID" = claude-code ]; then
      native="$prefix/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude"
      mkdir -p "$(dirname "$native")"
      printf '#!/bin/sh\\nprintf "Claude %s\\\\n"\\n' "$FIXTURE_VERSION" > "$native"
      printf '#!/bin/sh\\nexit 19\\n' > "$prefix/bin/claude"
      chmod 755 "$prefix/bin/claude"
    else
      printf '#!/bin/sh\\nprintf "codex %s\\\\n"\\n' "$FIXTURE_VERSION" > "$prefix/bin/codex"
      chmod 755 "$prefix/bin/codex"
    fi
    ;;
  *) exit 8 ;;
esac`)
  await executable(path.join(bin, 'uv'), `
[ "\${FAIL_DOWNLOAD:-}" != 1 ] || exit 9
case "$2" in
  list)
    printf 'cpython-3.15.0a1-darwin-aarch64-none\\n'
    [ "\${4:-}" = 3.15 ] || printf 'cpython-%s-darwin-aarch64-none\\n' "$FIXTURE_LATEST"
    ;;
  install)
    shift 2
    while [ "$#" -gt 0 ]; do
      case "$1" in --install-dir) destination="$2"; shift ;; esac
      shift
    done
    mkdir -p "$UV_CACHE_DIR"
    printf cached > "$UV_CACHE_DIR/archive"
    destination="$destination/cpython-$FIXTURE_VERSION-darwin-aarch64-none"
    mkdir -p "$destination/bin"
    printf '#!/bin/sh\\nprintf "Python %s\\\\n"\\n' "$FIXTURE_VERSION" > "$destination/bin/python3"
    printf '#!/bin/sh\\nprintf "pip 25.0\\\\n"\\n' > "$destination/bin/pip3"
    chmod 755 "$destination/bin/"*
    printf 'new working copy' > "$destination/../../marker"
    ;;
  *) exit 8 ;;
esac`)
  await executable(path.join(bin, 'mv'), `
case "$1" in
  */.staging-*/root) [ "\${FAIL_RENAME:-}" != 1 ] || exit 7 ;;
esac
exec /bin/mv "$@"`)
  const result = path.join(root, 'result.json')
  const env = { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: root, MEMOH_DEP_HOME: home,
    MEMOH_DEP_ID: id, MEMOH_DEP_VERSION: version, MEMOH_DEP_CURRENT_VERSION: version,
    MEMOH_DEP_RESULT: result, MEMOH_DEP_OS: 'darwin', MEMOH_DEP_ARCH: 'arm64', MEMOH_DEP_LIBC: '',
    FIXTURE_ROOT: root, FIXTURE_DIGEST: digest, FIXTURE_VERSION: version, FIXTURE_LATEST: version,
    NODEJS_MIRROR: 'https://mirror.invalid/node', UV_RELEASES_URL: 'https://mirror.invalid/uv',
    NPM_MIRROR: 'https://mirror.invalid/npm', npm_config_strict_allow_scripts: 'true' }
  async function run(action: string, overrides: Record<string, string> = {}) {
    const manifest = parse(await readFile(path.join(scripts, id, 'dependency.yaml'), 'utf8'))
    const body = await readFile(path.join(scripts, id, manifest.scripts[action.replaceAll('-', '_')]), 'utf8')
    const source = `set -eu
      dep_log() { printf '%s\\n' "$*" >&2; }
      dep_result() { [ "\${FAIL_RESULT:-}" != 1 ] || return 5; printf '%s' "$1" > "$MEMOH_DEP_RESULT"; }
      dep_switch() {
        [ "\${FAIL_SWITCH:-}" != 1 ] || return 6
        ln -s "$1" "$MEMOH_DEP_HOME/current.next"
        mv -f "$MEMOH_DEP_HOME/current.next" "$MEMOH_DEP_HOME/current"
      }
      memoh_dep_main() {
      ${body}
      }
      memoh_dep_main < /dev/null
    `
    const child = Bun.spawn(['/bin/sh', '-s'], { env: { ...env, ...overrides }, stdin: new TextEncoder().encode(source), stdout: 'pipe', stderr: 'pipe' })
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { status, stdout, stderr }
  }
  return { root, home, old, result, run }
}

describe('dependency recipe failure recovery', () => {
  for (const id of recipes) for (const action of ['install', 'update']) {
    test(`${id} ${action} replaces the version and produces working entrypoints`, async () => {
      const f = await fixture(id)
      const result = await f.run(action)
      expect(result, result.stderr).toMatchObject({ status: 0 })
      const output = JSON.parse(await readFile(f.result, 'utf8'))
      expect(output.version).toBe(version)
      for (const command of Object.values(output.entrypoints) as string[]) {
        expect(spawnSync(command, ['--version']).status).toBe(0)
      }
      if (id === 'antigravity') {
        expect(spawnSync(output.entrypoints.agy, ['--version'], { encoding: 'utf8' }).stdout).toBe(`${version}\n`)
      } else {
        expect(await readFile(path.join(f.home, id === 'uv' ? 'current/bin/marker' : 'current/marker'), 'utf8')).toBe('new working copy')
      }
      expect(await Bun.file(path.join(f.root, 'postinstall-ran')).exists()).toBe(false)
    })
    for (const failure of ['FAIL_RESULT', 'FAIL_RENAME', 'FAIL_SWITCH']) {
      test(`${id} ${action} retains the current installation after ${failure}`, async () => {
        const f = await fixture(id)
        const result = await f.run(action, { [failure]: '1' })
        expect(result.status, result.stderr).not.toBe(0)
        expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
        await f.run(action, { FAIL_DOWNLOAD: '1' })
        expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
      })
    }
    test(`${id} ${action} recovers a previous tree before an offline retry`, async () => {
      const f = await fixture(id)
      await rename(f.old, `${f.old}.previous-12345`)
      await f.run(action, { FAIL_DOWNLOAD: '1' })
      expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
    })
  }
  for (const id of ['node', 'uv'] as const) {
    test(`${id} rejects a tampered mirror archive using the official checksum`, async () => {
      const f = await fixture(id)
      const result = await f.run('install', { FIXTURE_DIGEST: '0'.repeat(64) })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('SHA256 mismatch')
      expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
      const downloads = await readFile(path.join(f.root, 'downloads'), 'utf8')
      expect(downloads).toContain('https://mirror.invalid/')
      expect(downloads).toContain(id === 'node' ? 'https://nodejs.org/dist/' : 'https://github.com/astral-sh/uv/releases/download/')
    })
  }
  test('a minor Python request does not silently select an alpha', async () => {
    const f = await fixture('python')
    const result = await f.run('install', { MEMOH_DEP_VERSION: '3.15' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('no downloadable CPython')
    expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
  })
  for (const id of recipes) {
    test(`${id} never offers a downgrade from a newer installed release`, async () => {
      const f = await fixture(id)
      const result = await f.run('check-update', { MEMOH_DEP_CURRENT_VERSION: '4.0.0' })
      expect(result, result.stderr).toMatchObject({ status: 0 })
      expect(JSON.parse(await readFile(f.result, 'utf8')).update_available).toBe(false)
    })
  }
  for (const id of recipes) for (const installed of ['3.9.9', '3.14.2-alpha.1', '3.14.2']) {
    test(`${id} compares ${installed} against the stable release`, async () => {
      const f = await fixture(id)
      const result = await f.run('check-update', { MEMOH_DEP_CURRENT_VERSION: installed })
      expect(result, result.stderr).toMatchObject({ status: 0 })
      expect(JSON.parse(await readFile(f.result, 'utf8')).update_available).toBe(installed !== version)
    })
  }
  for (const id of ['python', 'codex', 'claude-code'] as const) {
    test(`${id} remove cleans the recipe-owned package manager cache`, async () => {
      const f = await fixture(id)
      expect((await f.run('install')).status).toBe(0)
      const cache = path.join(f.home, 'cache', id === 'python' ? 'uv' : 'npm', 'archive')
      expect(await Bun.file(cache).exists()).toBe(true)
      expect((await f.run('remove')).status).toBe(0)
      expect(await Bun.file(cache).exists()).toBe(false)
    })
  }
})

describe('Antigravity CLI distribution', () => {
  for (const [os, arch, libc, assetPlatform] of [
    ['linux', 'amd64', 'glibc', 'linux_x64'],
    ['linux', 'arm64', 'glibc', 'linux_arm64'],
    ['linux', 'amd64', 'musl', 'linux_x64_musl'],
    ['linux', 'arm64', 'musl', 'linux_arm64_musl'],
    ['darwin', 'amd64', '', 'mac_x64'],
    ['darwin', 'arm64', '', 'mac_arm64'],
  ]) {
    test(`latest install selects the official ${assetPlatform} archive`, async () => {
      const f = await fixture('antigravity')
      const result = await f.run('install', {
        MEMOH_DEP_VERSION: 'latest', MEMOH_DEP_OS: os!, MEMOH_DEP_ARCH: arch!, MEMOH_DEP_LIBC: libc!,
      })
      expect(result, result.stderr).toMatchObject({ status: 0 })
      const downloads = await readFile(path.join(f.root, 'downloads'), 'utf8')
      expect(downloads).toContain('https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest')
      expect(downloads).toContain(`https://github.com/google-antigravity/antigravity-cli/releases/download/${version}/agy_cli_${assetPlatform}.tar.gz`)
      expect(JSON.parse(await readFile(f.result, 'utf8'))).toMatchObject({
        version, entrypoints: { agy: path.join(f.home, 'current/bin/agy') },
      })
    })
  }

  test('an exact version uses its official GitHub release instead of the newer channel', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: `v${version}`, FIXTURE_LATEST: '4.0.0' })
    expect(result, result.stderr).toMatchObject({ status: 0 })
    expect(JSON.parse(await readFile(f.result, 'utf8')).version).toBe(version)
    const downloads = await readFile(path.join(f.root, 'downloads'), 'utf8')
    expect(downloads).toContain(`https://api.github.com/repos/google-antigravity/antigravity-cli/releases/tags/${version}`)
    expect(downloads).toContain(`https://github.com/google-antigravity/antigravity-cli/releases/download/${version}/agy_cli_mac_arm64.tar.gz`)
  })

  test('an exact-version checksum mismatch preserves the working installation', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: version, FIXTURE_LATEST: '4.0.0', FIXTURE_DIGEST: '0'.repeat(64) })
    expect(result.status, result.stderr).not.toBe(0)
    expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
    expect(await Bun.file(f.result).exists()).toBe(false)
  })

  test('an unavailable exact version fails without installing the latest release', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: version, FAIL_RELEASE: '1', FIXTURE_LATEST: '4.0.0' })
    expect(result.status, result.stderr).not.toBe(0)
    expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
    expect(await readFile(path.join(f.root, 'downloads'), 'utf8')).not.toContain('.tar.gz')
  })

  for (const action of ['install', 'check-update']) {
    for (const [name, overrides] of [
      ['unavailable release', { FAIL_RELEASE: '1' }],
      ['malformed JSON', { FIXTURE_RELEASE_BODY: '{"tag_name":' }],
      ['invalid version', { FIXTURE_LATEST: '../../outside' }],
    ] as const) {
      test(`${action} fails closed on ${name}`, async () => {
        const f = await fixture('antigravity')
        const result = await f.run(action, { MEMOH_DEP_VERSION: 'latest', ...overrides })
        expect(result.status, result.stderr).not.toBe(0)
        expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
        expect(await Bun.file(f.result).exists()).toBe(false)
        expect(await readFile(path.join(f.root, 'downloads'), 'utf8')).not.toContain('.tar.gz')
      })
    }
  }

  for (const [name, overrides] of [
    ['invalid checksum', { FIXTURE_DIGEST: 'not-a-checksum' }],
    ['HTTP download', { FIXTURE_ARCHIVE_URL: `http://github.com/google-antigravity/antigravity-cli/releases/download/${version}/agy_cli_mac_arm64.tar.gz` }],
    ['foreign host', { FIXTURE_ARCHIVE_URL: `https://github.com.evil.invalid/google-antigravity/antigravity-cli/releases/download/${version}/agy_cli_mac_arm64.tar.gz` }],
    ['unrelated GitHub repository', { FIXTURE_ARCHIVE_URL: `https://github.com/unrelated/antigravity-cli/releases/download/${version}/agy_cli_mac_arm64.tar.gz` }],
  ] as const) {
    test(`install rejects ${name} before downloading the archive`, async () => {
      const f = await fixture('antigravity')
      const result = await f.run('install', { MEMOH_DEP_VERSION: 'latest', ...overrides })
      expect(result.status, result.stderr).not.toBe(0)
      expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
      const downloads = await readFile(path.join(f.root, 'downloads'), 'utf8')
      expect(downloads).not.toContain('.tar.gz')
    })
  }

  test('a checksum mismatch preserves the working installation', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: 'latest', FIXTURE_DIGEST: '0'.repeat(64) })
    expect(result.status, result.stderr).not.toBe(0)
    expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
    expect(await Bun.file(f.result).exists()).toBe(false)
  })

  test('a downloaded binary that cannot run preserves the working installation', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: 'latest', FAIL_NATIVE: '1' })
    expect(result.status, result.stderr).not.toBe(0)
    expect(await readFile(path.join(f.home, 'current/marker'), 'utf8')).toBe('old working copy')
    expect(await Bun.file(f.result).exists()).toBe(false)
  })

  test('agy preserves arguments and disables self-update through a workspace symlink', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: 'latest' })
    expect(result, result.stderr).toMatchObject({ status: 0 })
    const { entrypoints } = JSON.parse(await readFile(f.result, 'utf8'))
    const shim = path.join(f.root, 'workspace with spaces/bin/agy')
    await mkdir(path.dirname(shim), { recursive: true })
    await symlink(path.relative(path.dirname(shim), entrypoints.agy), shim)
    for (const command of [entrypoints.agy, shim]) {
      const invoked = spawnSync(command, ['task with spaces', '', '--flag=value'], {
        cwd: f.root, env: { PATH: '/usr/bin:/bin', AGY_CLI_DISABLE_AUTO_UPDATE: 'false' }, encoding: 'utf8',
      })
      expect(invoked.status, invoked.stderr).toBe(0)
      expect(invoked.stdout).toBe('auto_update_disabled=true\narg=task with spaces\narg=\narg=--flag=value\n')
    }
  })

  test('remove deletes the managed installation and its entrypoint', async () => {
    const f = await fixture('antigravity')
    const installed = await f.run('install', { MEMOH_DEP_VERSION: 'latest' })
    expect(installed, installed.stderr).toMatchObject({ status: 0 })
    const removed = await f.run('remove')
    expect(removed, removed.stderr).toMatchObject({ status: 0 })
    expect(await Bun.file(path.join(f.home, 'current/bin/agy')).exists()).toBe(false)
    expect(JSON.parse(await readFile(f.result, 'utf8'))).toEqual({})
  })

  test('the wrapper rejects native install and update commands', async () => {
    const f = await fixture('antigravity')
    const result = await f.run('install', { MEMOH_DEP_VERSION: 'latest' })
    expect(result, result.stderr).toMatchObject({ status: 0 })
    const { entrypoints } = JSON.parse(await readFile(f.result, 'utf8'))
    for (const action of ['install', 'update']) {
      const invoked = spawnSync(entrypoints.agy, [action], { encoding: 'utf8' })
      expect(invoked.status, invoked.stderr).not.toBe(0)
      expect(invoked.stdout).not.toContain('auto_update_disabled=')
    }
  })
})
