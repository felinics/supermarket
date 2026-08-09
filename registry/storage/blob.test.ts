import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_SKILL_ARTIFACT_COMPRESSED_BYTES } from '../types'
import type { SkillArtifactDescriptor, SkillImageAsset, SkillRegistryDefinition, SkillRegistrySnapshot } from '../types'
import { LocalSkillRegistryStore } from './local'
import { R2BlobBackend } from './r2'
import { sha256 } from '#lib/digest'
import {
  BlobSkillRegistryStore,
  MAX_REGISTRY_STATE_BYTES,
} from './blob'
import { validateStoredSnapshot } from './validation'
import type { BlobBackend } from './contracts'
import { summarizeCurrentSnapshot } from '../catalog'
import { registrySnapshotRevision, serializeRegistrySnapshot } from '../snapshot'
import { packageSkill } from '../artifacts/build'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const definition: SkillRegistryDefinition = {
  schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10,
  adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
}

async function skillArtifact(content: string) {
  const packaged = await packageSkill({
    'SKILL.md': { bytes: new TextEncoder().encode(content), mode: 0o644 },
  })
  const descriptor: SkillArtifactDescriptor = {
    format: 'memoh_skill_v1', digest: packaged.digest, size: packaged.bytes.length,
    uncompressed_size: packaged.uncompressedSize, archive_size: packaged.archiveSize,
    file_count: packaged.fileCount,
    content_type: 'application/gzip',
  }
  return { descriptor, bytes: packaged.bytes }
}

function snapshot(
  sourceRevision = 'source',
): SkillRegistrySnapshot {
  return {
    schema_version: '1',
    registry_id: definition.id,
    registry_priority: definition.priority,
    source: { type: 'local', revision: sourceRevision },
    packages: [],
    diagnostics: [],
  }
}

async function exerciseStore(store: LocalSkillRegistryStore | BlobSkillRegistryStore) {
  const firstSnapshot = snapshot()
  const bytes = serializeRegistrySnapshot(firstSnapshot)
  const revision = await store.publishSnapshot(bytes, definition, {
    publishedAt: '2026-01-01T00:00:00.000Z',
  })
  await expect(store.publishSnapshot(bytes, definition, {
    publishedAt: '2026-01-02T00:00:00.000Z',
  })).resolves.toBe(revision)
  expect((await store.getState('example'))?.definition.name).toBe('Example')
  expect(await store.getSnapshot('example', revision)).toEqual(firstSnapshot)
  expect(await store.listRegistryIDs()).toEqual(['example'])

  const { descriptor, bytes: artifactBytes } = await skillArtifact('artifact')
  const { digest } = descriptor
  await store.putArtifact(descriptor, artifactBytes)
  const artifact = await store.getArtifact(digest)
  expect(artifact?.bytes).toEqual(artifactBytes)
  expect(artifact?.descriptor).toEqual({
    format: 'memoh_skill_v1', digest, size: artifactBytes.length, content_type: 'application/gzip',
  })
  const streamed = await store.getArtifactStream(digest)
  expect(streamed?.body).toBeInstanceOf(ReadableStream)
  if (!(streamed?.body instanceof ReadableStream)) throw new Error('Expected an Artifact stream')
  expect([...new Uint8Array(await new Response(streamed.body).arrayBuffer())]).toEqual([...artifactBytes])
  await expect(store.putArtifact(descriptor, artifactBytes)).resolves.toEqual({ stored: false })
  await expect(store.putArtifact({ ...descriptor, size: artifactBytes.length + 1 }, artifactBytes)).rejects.toThrow('size')
  await expect(store.putArtifact({ ...descriptor, size: MAX_SKILL_ARTIFACT_COMPRESSED_BYTES + 1 }, artifactBytes))
    .rejects.toThrow('compressed size limit')
  const imageBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const image: SkillImageAsset = {
    digest: await sha256(imageBytes), size: imageBytes.length, content_type: 'image/svg+xml',
  }
  await store.putImage(image, imageBytes)
  expect(await store.getImage(image.digest)).toEqual({ descriptor: image, bytes: imageBytes })
  return { descriptor, bytes: artifactBytes }
}

function memoryBackend() {
  const objects = new Map<string, Uint8Array>()
  const gets = new Map<string, number>()
  const behavior: {
    failPuts: number
    landDespiteError: boolean
    failKey?: string
  } = { failPuts: 0, landDespiteError: false }
  const backend: BlobBackend = {
    async get(key) {
      gets.set(key, (gets.get(key) ?? 0) + 1)
      return objects.get(key)?.slice() ?? null
    },
    async put(key, value) {
      if (behavior.failPuts > 0 && (!behavior.failKey || behavior.failKey === key)) {
        behavior.failPuts--
        if (behavior.landDespiteError) objects.set(key, value.slice())
        throw new Error(`S3 PUT outcome is unknown: ${key}`)
      }
      objects.set(key, value.slice())
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    },
    async listPrefixes(prefix) {
      return [...new Set([...objects.keys()].flatMap((key) => {
        if (!key.startsWith(prefix)) return []
        const separator = key.indexOf('/', prefix.length)
        return separator >= 0 ? [key.slice(0, separator + 1)] : []
      }))].sort()
    },
  }
  return { backend, gets, behavior, objects }
}

describe('Immutable digest-addressed uploads', () => {
  test('rejects invalid or incomplete Snapshot Artifact metadata', () => {
    const stored = snapshot()
    stored.packages.push({
      revision: 'a'.repeat(64),
      package_id: 'package', name: 'package', description: '', tags: [],
      skills: [{
        skill_id: 'skill',
        name: 'Skill',
        description: '',
        author: { name: '' },
        tags: [],
        category: 'other',
        category_name: 'Other',
        source_path: 'skill',
        files: ['SKILL.md'],
        artifact: {
          digest: 'b'.repeat(64),
          size: -1,
          uncompressed_size: 1,
          archive_size: 1,
          file_count: 1,
        },
      }],
    })
    expect(() => validateStoredSnapshot(
      stored,
      'example',
      'registries/example/snapshot.json',
    )).toThrow('Snapshot Artifact reference')

    stored.packages[0]!.skills[0]!.artifact = {
      digest: 'b'.repeat(64), size: 1, uncompressed_size: 1,
    } as SkillRegistrySnapshot['packages'][number]['skills'][number]['artifact']
    expect(() => validateStoredSnapshot(stored, 'example', 'incomplete-snapshot'))
      .toThrow('Snapshot Artifact reference')
  })

  test('rejects duplicate Package and nested Skill identities', () => {
    const skill = {
      skill_id: 'skill', name: 'Skill', description: '', author: { name: '' },
      tags: [], category: 'other', category_name: 'Other', source_path: 'skill',
      files: ['SKILL.md'],
      artifact: {
        digest: 'b'.repeat(64), size: 1, uncompressed_size: 1, archive_size: 1, file_count: 1,
      },
    }
    const stored = snapshot()
    stored.packages = [{
      revision: 'a'.repeat(64),
      package_id: 'package', name: 'package', description: '', tags: [],
      skills: [structuredClone(skill), structuredClone(skill)],
    }]
    expect(() => validateStoredSnapshot(stored, 'example', 'duplicate-skills'))
      .toThrow('Snapshot Artifact reference')

    stored.packages = [stored.packages[0]!, structuredClone(stored.packages[0]!)]
    stored.packages[0]!.skills = [skill]
    stored.packages[1]!.skills = [{ ...skill, skill_id: 'other' }]
    expect(() => validateStoredSnapshot(stored, 'example', 'duplicate-packages'))
      .toThrow('Snapshot Artifact reference')
  })

  test('rejects a Package that exceeds the client install budget', () => {
    const stored = snapshot()
    stored.packages = [{
      revision: 'a'.repeat(64),
      package_id: 'package', name: 'package', description: '', tags: [],
      skills: Array.from({ length: 65 }, (_, index) => ({
        skill_id: `skill-${index}`, name: `Skill ${index}`, description: '', author: { name: '' },
        tags: [], category: 'other', category_name: 'Other', source_path: `skill-${index}`,
        files: ['SKILL.md'],
        artifact: {
          digest: index.toString(16).padStart(64, '0'), size: 2 * 1024 * 1024,
          uncompressed_size: 1, archive_size: 1, file_count: 1,
        },
      })),
    }]
    expect(() => validateStoredSnapshot(stored, 'example', 'oversized-package'))
      .toThrow('Snapshot Artifact reference')
  })

  test('rejects stored Snapshot bytes that do not match their revision', async () => {
    const { backend, objects } = memoryBackend()
    const store = new BlobSkillRegistryStore(backend)
    const bytes = serializeRegistrySnapshot(snapshot())
    const revision = registrySnapshotRevision(bytes)
    objects.set(
      `skill-registries/example/snapshots/${revision}.json`,
      serializeRegistrySnapshot(snapshot('tampered')),
    )
    await expect(store.getSnapshot('example', revision)).rejects.toThrow('does not match its revision')
  })

  test('recovers when a Snapshot lands before its state pointer', async () => {
    const { backend, behavior } = memoryBackend()
    const store = new BlobSkillRegistryStore(backend)
    const firstAttempt = serializeRegistrySnapshot(snapshot('source'))

    behavior.failPuts = 1
    behavior.failKey = 'skill-registries/example/state.json'
    await expect(store.publishSnapshot(firstAttempt, definition, {
      publishedAt: '2026-01-01T00:00:00.000Z',
    })).rejects.toThrow('state.json')

    const revision = registrySnapshotRevision(firstAttempt)
    await expect(store.publishSnapshot(firstAttempt, definition, {
      publishedAt: '2026-01-02T00:00:00.000Z',
    })).resolves.toBe(revision)

    const state = await store.getState('example')
    expect(state?.current_snapshot).toBe(revision)
    expect(state?.current_summary?.published_at).toBe('2026-01-02T00:00:00.000Z')
  })

  test('settles unknown outcomes, retries transient failures, and skips stored archives', async () => {
    const { backend, gets, behavior, objects } = memoryBackend()
    const store = new BlobSkillRegistryStore(backend)
    const { descriptor, bytes } = await skillArtifact('artifact-retry')
    const { digest } = descriptor

    // The PUT reported an unknown outcome but actually landed: reading the key
    // back settles it without another write.
    behavior.failPuts = 1
    behavior.landDespiteError = true
    await expect(store.putArtifact(descriptor, bytes)).resolves.toEqual({ stored: true })
    expect((await store.getArtifact(digest))?.bytes).toEqual(bytes)

    // Steady state reuses the content-addressed archive.
    const archiveReads = gets.get(`skill-artifacts/${digest}.tar.gz`) ?? 0
    await expect(store.putArtifact(descriptor, bytes)).resolves.toEqual({ stored: false })
    expect(gets.get(`skill-artifacts/${digest}.tar.gz`) ?? 0).toBe(archiveReads + 1)

    // A transient failure that did not land is retried and succeeds.
    const { descriptor: secondDescriptor, bytes: secondBytes } = await skillArtifact('artifact-retry-second')
    behavior.failPuts = 1
    behavior.landDespiteError = false
    await expect(store.putArtifact(secondDescriptor, secondBytes)).resolves.toEqual({ stored: true })

    // A failure that never lands surfaces a PLAIN error after retries: a late
    // duplicate PUT of identical bytes is harmless, so publication can retry.
    const imageBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><title>retry</title></svg>')
    const image: SkillImageAsset = {
      digest: await sha256(imageBytes), size: imageBytes.length, content_type: 'image/svg+xml',
    }
    behavior.failPuts = Number.POSITIVE_INFINITY
    const failure = await store.putImage(image, imageBytes).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('upload did not complete')

    // Once the network recovers, the same upload succeeds cleanly.
    behavior.failPuts = 0
    await expect(store.putImage(image, imageBytes)).resolves.toEqual({ stored: true })
    expect((await store.getImage(image.digest))?.bytes).toEqual(imageBytes)

    objects.delete(`skill-images/${image.digest}`)
    await expect(store.putImage(image, imageBytes)).resolves.toEqual({ stored: true })
    objects.set(`skill-images/${image.digest}`, new TextEncoder().encode('corrupt'))
    await expect(store.putImage(image, imageBytes)).rejects.toThrow('immutable')
  }, 15_000)
})

function mockR2Bucket() {
  const objects = new Map<string, Uint8Array>()
  const versions = new Map<string, string>()
  let version = 0
  return {
    objects,
    versions,
    async get(key: string) {
      const value = objects.get(key)
      return value ? { arrayBuffer: async () => value.slice().buffer, etag: versions.get(key)! } : null
    },
    async put(key: string, value: Uint8Array, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      const current = versions.get(key)
      if (options?.onlyIf?.etagDoesNotMatch === '*' && current) return null
      if (options?.onlyIf?.etagMatches != null && options.onlyIf.etagMatches !== current) return null
      const etag = `version-${++version}`
      objects.set(key, value.slice())
      versions.set(key, etag)
      return { etag }
    },
    async delete(key: string) {
      objects.delete(key)
      versions.delete(key)
    },
    async list({ prefix = '', cursor, delimiter }: { prefix?: string; cursor?: string; delimiter?: string } = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      if (delimiter) {
        const delimitedPrefixes = [...new Set(keys.flatMap((key) => {
          const remainder = key.slice(prefix.length)
          const separator = remainder.indexOf(delimiter)
          return separator >= 0 ? [`${prefix}${remainder.slice(0, separator + 1)}`] : []
        }))]
        return { objects: [], delimitedPrefixes, truncated: false, cursor: undefined }
      }
      const offset = cursor ? Number(cursor) : 0
      const page = keys.slice(offset, offset + 1)
      return { objects: page.map((key) => ({ key })), truncated: offset + page.length < keys.length, cursor: String(offset + page.length) }
    },
  }
}

describe('Registry state compare-and-swap', () => {
  test('rejects a stale putState write instead of clobbering a concurrent publish', async () => {
    const store = new BlobSkillRegistryStore(new R2BlobBackend(mockR2Bucket()))
    const first = snapshot('source')
    const firstBytes = serializeRegistrySnapshot(first)
    const firstRevision = await store.publishSnapshot(firstBytes, definition, {
      publishedAt: '2026-01-01T00:00:00.000Z',
    })

    const readBeforeRace = await store.getStateWithVersion('example')
    expect(readBeforeRace.state?.current_snapshot).toBe(firstRevision)
    expect(readBeforeRace.versioning).toBe('conditional')
    if (readBeforeRace.versioning !== 'conditional') throw new Error('Expected conditional versioning')
    const staleVersion = readBeforeRace.version

    // A second publish run wins the race and moves the pointer forward.
    const second = snapshot('source-two')
    const secondBytes = serializeRegistrySnapshot(second)
    const secondRevision = await store.publishSnapshot(secondBytes, definition, {
      publishedAt: '2026-01-02T00:00:00.000Z',
    })
    const currentRead = await store.getStateWithVersion('example')
    if (currentRead.versioning !== 'conditional') throw new Error('Expected conditional versioning')
    const currentVersion = currentRead.version
    expect(currentVersion).not.toBe(staleVersion)

    // A late write from the first run, still holding the stale version, must
    // not be allowed to overwrite the second run's newer pointer.
    await expect(store.putState({
      schema_version: '1',
      definition,
      current_snapshot: firstRevision,
      current_summary: summarizeCurrentSnapshot(
        first,
        firstRevision,
        '2026-01-01T00:00:00.000Z',
      ),
    }, staleVersion)).rejects.toThrow('changed concurrently')

    const final = await store.getState('example')
    expect(final?.current_snapshot).toBe(secondRevision)
  })

  test('publishSnapshot forwards its expected version and rejects a stale race', async () => {
    const store = new BlobSkillRegistryStore(new R2BlobBackend(mockR2Bucket()))
    const first = serializeRegistrySnapshot(snapshot('source'))
    await store.publishSnapshot(first, definition)
    const staleRead = await store.getStateWithVersion('example')
    if (staleRead.versioning !== 'conditional') throw new Error('Expected conditional versioning')
    const staleVersion = staleRead.version

    const concurrent = serializeRegistrySnapshot(snapshot('source-two'))
    const concurrentRevision = await store.publishSnapshot(concurrent, definition)

    const stale = serializeRegistrySnapshot(snapshot('source-three'))
    await expect(store.publishSnapshot(stale, definition, {
      expectedVersion: staleVersion,
    })).rejects.toThrow('changed concurrently')
    expect((await store.getState('example'))?.current_snapshot).toBe(concurrentRevision)
  })

  test('Local backend explicitly reports single-writer semantics and rejects conditional writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-registry-cas-'))
    roots.push(root)
    const store = new LocalSkillRegistryStore(root)
    await store.publishSnapshot(serializeRegistrySnapshot(snapshot()), definition)
    const result = await store.getStateWithVersion('example')
    expect(result).toMatchObject({ versioning: 'none' })
    await expect(store.putState(result.state!, null)).rejects.toThrow('does not support conditional writes')
  })

  test('rejects backends that implement only half of the conditional-write contract', () => {
    const { backend } = memoryBackend()
    Object.assign(backend, { async getWithVersion() { return null } })
    expect(() => new BlobSkillRegistryStore(backend))
      .toThrow('must implement getWithVersion and putConditional together')
  })
})

describe('SkillRegistryStore contract', () => {
  test('Local store publishes snapshots before state and stores content-addressed artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-registry-store-'))
    roots.push(root)
    const store = new LocalSkillRegistryStore(root)
    const artifact = await exerciseStore(store)
    const digest = artifact.descriptor.digest
    const state = JSON.parse(await readFile(path.join(root, 'skill-registries/example/state.json'), 'utf8'))
    const revision = registrySnapshotRevision(serializeRegistrySnapshot(snapshot()))
    expect(state.current_snapshot).toBe(revision)
    expect(state.current_summary).toMatchObject({ revision, skill_count: 0 })
    await Bun.write(path.join(root, 'skill-registries/example/state.json'), JSON.stringify({ ...state, current_snapshot: '../invalid' }))
    await expect(store.getState('example')).rejects.toThrow('digest')
    await Bun.write(path.join(root, 'skill-registries/example/state.json'), JSON.stringify(state))
    await expect(store.putState({
      ...state,
      definition: { ...state.definition, name: 'x'.repeat(MAX_REGISTRY_STATE_BYTES) },
    })).rejects.toThrow('state exceeds')
    await Bun.write(path.join(root, `skill-artifacts/${digest}.tar.gz`), 'corrupt')
    await expect(store.getArtifact(digest)).rejects.toThrow('corrupt')
  })

  test('R2 backend handles paginated object listings', async () => {
    const bucket = mockR2Bucket()
    const { objects } = bucket
    const store = new BlobSkillRegistryStore(new R2BlobBackend(bucket))
    const artifact = await exerciseStore(store)
    const digest = artifact.descriptor.digest
    const streamed = await store.getArtifactStream(digest)
    expect(streamed?.body).toBeInstanceOf(ReadableStream)
    if (!(streamed?.body instanceof ReadableStream)) throw new Error('Expected an R2 Artifact stream')
    expect([...new Uint8Array(await new Response(streamed.body).arrayBuffer())])
      .toEqual([...artifact.bytes])
    objects.set(`skill-artifacts/${digest}.tar.gz`, new TextEncoder().encode('corrupt!'))
    await expect(store.putArtifact(artifact.descriptor, artifact.bytes)).rejects.toThrow('immutable')
  })
})
