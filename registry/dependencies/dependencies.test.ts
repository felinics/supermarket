import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildDependencyCandidate } from './build'
import { lockDependencies, approvedDependencies } from './release-lock'
import { dependencyJSON, parseDependencyManifest, validateDependencyGraph } from './types'
import { DependencyRegistryStore } from './store'
import { LocalBlobBackend } from '../storage/local'
import { sha256 } from '#lib/digest'
import { parseGzipTarArchive } from '#client/archive'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

export async function dependencyFixture(root: string, script = 'printf "version one"\n') {
  const dir = path.join(root, 'registries/memoh/dependencies/demo')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'dependency.yaml'), `schema_version: "1"
id: demo
name: Demo
description: Demonstrates remote dependency publication.
category: tool
source: managed
provides: [demo]
platforms: [{os: linux, arch: [amd64, arm64], libc: glibc}]
scripts: {install: install.sh, remove: remove.sh}
translations: {zh: {name: 示例}}
`)
  await writeFile(path.join(dir, 'install.sh'), script)
  await writeFile(path.join(dir, 'remove.sh'), 'printf "removed"\n')
  return dir
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-registry-'))
  roots.push(root)
  const dir = await dependencyFixture(root)
  return { root, dir }
}

describe('Dependency publication', () => {
  test('builds deterministic releases, archives and an independently locked snapshot', async () => {
    const { root, dir } = await fixture()
    const first = await lockDependencies(root)
    const second = await approvedDependencies(root)
    expect(second.revision).toBe(first.revision)
    const descriptor = first.snapshot.dependencies[0]!
    expect(await sha256(dependencyJSON(first.releases[0]))).toBe(descriptor.revision)
    const archive = first.artifacts.get(descriptor.artifact.digest)!
    expect(await sha256(archive)).toBe(descriptor.artifact.digest)
    const files = await parseGzipTarArchive(archive)
    expect([...files.keys()].sort()).toEqual(['dependency.yaml', 'install.sh', 'remove.sh'])
    await writeFile(path.join(dir, 'install.sh'), 'printf "version two"\n')
    await expect(approvedDependencies(root)).rejects.toThrow('does not match')
    const changed = await buildDependencyCandidate(root)
    expect(changed.revision).not.toBe(first.revision)
    expect(changed.releases[0]!.manifest_digest).not.toBe(descriptor.manifest_digest)
  })

  test('rejects unknown fields, duplicate YAML keys, missing scripts and paths outside the entry', async () => {
    const { root, dir } = await fixture()
    const filename = path.join(dir, 'dependency.yaml')
    const original = await readFile(filename, 'utf8')
    for (const content of [original + '\nunknown: value\n', original + '\nid: another\n', original.replace('install.sh', '../install.sh'), original.replace('install.sh', 'missing.sh')]) {
      await writeFile(filename, content)
      await expect(buildDependencyCandidate(root)).rejects.toThrow()
    }
  })

  test('rejects symlinks and excessive entry content', async () => {
    const { root, dir } = await fixture()
    await symlink(path.join(dir, 'install.sh'), path.join(dir, 'link.sh'))
    await expect(buildDependencyCandidate(root)).rejects.toThrow('symlinks')
    await rm(path.join(dir, 'link.sh'))
    await writeFile(path.join(dir, 'install.sh'), 'x'.repeat(1024 * 1024))
    await expect(buildDependencyCandidate(root)).rejects.toThrow('budget')
  })

  test('rejects missing prerequisites and cycles', async () => {
    const { root } = await fixture()
    const manifest = (await buildDependencyCandidate(root)).releases[0]!.manifest
    expect(() => validateDependencyGraph([{ ...manifest, requires: ['missing'] }])).toThrow('Unknown')
    expect(() => validateDependencyGraph([{ ...manifest, requires: ['demo'] }])).toThrow('cycle')
    expect(() => validateDependencyGraph([{ ...manifest, requires: ['second'] }, { ...manifest, id: 'second', requires: ['demo'] }])).toThrow('cycle')
    expect(() => parseDependencyManifest({ ...manifest, schema_version: '2' })).toThrow()
  })

  test('preserves historical releases and Skill state when latest changes or the registry is disabled', async () => {
    const { root, dir } = await fixture()
    const backend = new LocalBlobBackend(path.join(root, 'store'))
    const skillState = new TextEncoder().encode('existing Skill state')
    await backend.put('skill-registries/memoh/state.json', skillState)
    const store = new DependencyRegistryStore(backend)
    const first = await buildDependencyCandidate(root)
    await store.publish(first)
    await writeFile(path.join(dir, 'install.sh'), 'printf "updated"\n')
    const second = await buildDependencyCandidate(root)
    await store.publish(second)
    expect((await store.current())!.revision).toBe(second.revision)
    expect((await store.release('demo', first.snapshot.dependencies[0]!.revision))!.release).toEqual(first.releases[0]!)
    await store.publish(second, false)
    expect(await store.current()).toBeNull()
    expect(await store.release('demo', first.snapshot.dependencies[0]!.revision)).not.toBeNull()
    expect(await backend.get('skill-registries/memoh/state.json')).toEqual(skillState)
  })

  test('rejects corrupted release, snapshot and artifact bytes', async () => {
    const { root } = await fixture()
    const backend = new LocalBlobBackend(path.join(root, 'store'))
    const store = new DependencyRegistryStore(backend)
    const candidate = await buildDependencyCandidate(root)
    await store.publish(candidate)
    const descriptor = candidate.snapshot.dependencies[0]!
    for (const [key, read] of [
      [`dependency-registries/memoh/releases/demo/${descriptor.revision}.json`, () => store.release('demo', descriptor.revision)],
      [`dependency-registries/memoh/snapshots/${candidate.revision}.json`, () => store.current()],
      [`artifacts/dependency/${descriptor.artifact.digest}.tar.gz`, () => store.artifact(descriptor.artifact.digest)],
    ] as const) {
      await backend.put(key, new TextEncoder().encode('corrupt'))
      await expect(read()).rejects.toThrow('Invalid stored')
    }
  })

  test('the five approved official dependencies build and retain the expected runtime commands', async () => {
    const candidate = await approvedDependencies(path.resolve(import.meta.dirname, '../..'))
    expect(candidate.releases.map((item) => item.dependency_id)).toEqual(['claude-code', 'codex', 'node', 'python', 'uv'])
    expect(candidate.releases.find((item) => item.dependency_id === 'codex')!.manifest.provides).toEqual(['codex'])
    expect(candidate.releases.every((item) => item.icon && item.manifest.translations?.zh && item.manifest.translations?.ja)).toBe(true)
  })
})
