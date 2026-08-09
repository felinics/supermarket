import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { H3 } from 'h3'
import { extractSkillArchive, parseGzipTarArchive } from '../client/archive'
import artifactDownload from '../server/api/artifacts/skill/[digest].get'
import skillIcon from '../server/api/artifacts/icon/[digest].get'
import packages from '../server/api/packages/index.get'
import registryPackage from '../server/api/registries/[id]/packages/[packageId].get'
import registryPackageRelease from '../server/api/registries/[id]/packages/[packageId]/releases/[revision].get'
import registryPackages from '../server/api/registries/[id]/packages/index.get'
import registrySkill from '../server/api/registries/[id]/packages/[packageId]/skills/[skillId].get'
import registryCategories from '../server/api/registries/[id]/categories.get'
import registrySkills from '../server/api/registries/[id]/skills/index.get'
import registries from '../server/api/registries/index.get'
import skills from '../server/api/skills/index.get'
import type {
  CatalogSkill,
  PackagePostinstallCommand,
  SkillArtifactDescriptor,
  SkillRegistryDefinition,
  SkillRegistrySnapshot,
} from '#registry/types'
import {
  compactCatalogPackages,
  serializeRegistrySnapshot,
  skillPackageReleaseFromSnapshotPackage,
} from '#registry/snapshot'
import { R2BlobBackend } from '#registry/storage/r2'
import { sha256 } from '#lib/digest'
import { BlobSkillRegistryStore } from '#registry/storage/blob'
import { packageSkill } from '#registry/artifacts/build'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function inMemoryBucket() {
  const objects = new Map<string, Uint8Array>()
  const versions = new Map<string, string>()
  let version = 0
  return {
    async get(key: string) {
      const value = objects.get(key)
      return value ? {
        size: value.length, body: new Blob([value.slice().buffer as ArrayBuffer]).stream(),
        arrayBuffer: async () => value.slice().buffer, etag: versions.get(key)!,
      } : null
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
      const page = keys.slice(offset, offset + 2)
      return {
        objects: page.map((key) => ({ key })), truncated: offset + page.length < keys.length,
        cursor: String(offset + page.length), delimitedPrefixes: [],
      }
    },
  }
}

describe('Marketplace HTTP protocol', () => {
  test('discovers, searches, downloads and installs immutable Skill releases', async () => {
    const bucket = inMemoryBucket()
    const store = new BlobSkillRegistryStore(new R2BlobBackend(bucket))
    const definition: SkillRegistryDefinition = {
      schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10,
      adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
    }
    const installID = 'example+tools+demo'
    const sourceRevision = 'e'.repeat(64)
    const packaged = await packageSkill({
      'SKILL.md': {
        bytes: new TextEncoder().encode('---\nname: Demo\ndescription: Demo\n---\n'),
        mode: 0o644,
      },
      'scripts/run.sh': { bytes: new TextEncoder().encode('#!/bin/sh\n'), mode: 0o755 },
    })
    const archive = packaged.bytes
    const digest = packaged.digest
    const artifact: SkillArtifactDescriptor = {
      format: 'memoh_skill_v1', digest, size: archive.length,
      uncompressed_size: packaged.uncompressedSize,
      archive_size: packaged.archiveSize,
      file_count: packaged.fileCount,
      content_type: 'application/gzip',
    }
    const imageBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const image = { digest: await sha256(imageBytes), size: imageBytes.length, content_type: 'image/svg+xml' as const }
    const skill: CatalogSkill = {
      schema_version: '1', registry_id: 'example', registry_priority: 10,
      package_id: 'tools', skill_id: 'demo', install_id: installID,
      name: 'Demo', description: 'Demo Skill', author: { name: 'Test', email: '' },
      tags: ['demo'], category: 'developer-tools', category_name: 'Developer Tools',
      source: { type: 'local', revision: sourceRevision, path: 'skills/demo' },
      files: ['SKILL.md', 'scripts/run.sh'], icon: { card: image, detail: image, brand_color: '#0B7285' }, artifact,
    }
    const postinstall: PackagePostinstallCommand[] = [
      { command: 'npm', args: ['install', '--global', 'opencli'] },
    ]
    const packageMetadata = new Map([['tools', { postinstall }]])
    const snapshot: SkillRegistrySnapshot = {
      schema_version: '1', registry_id: 'example', registry_priority: 10,
      source: { type: 'local', revision: sourceRevision },
      packages: compactCatalogPackages([skill], packageMetadata),
      diagnostics: [],
    }
    await store.putArtifact(artifact, archive)
    await store.putImage(image, imageBytes)
    await store.putPackageRelease(
      skillPackageReleaseFromSnapshotPackage(snapshot, snapshot.packages[0]!),
    )
    const snapshotRevision = await store.publishSnapshot(serializeRegistrySnapshot(snapshot), definition, {
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    const app = new H3()
    app.use((event) => { (event.req as any).runtime = { cloudflare: { env: { SKILL_REGISTRY_BUCKET: bucket } } } })
    app.get('/api/registries', registries)
    app.get('/api/skills', skills)
    app.get('/api/packages', packages)
    app.get('/api/registries/:id/categories', registryCategories)
    app.get('/api/registries/:id/skills', registrySkills)
    app.get('/api/registries/:id/packages', registryPackages)
    app.get('/api/registries/:id/packages/:packageId', registryPackage)
    app.get('/api/registries/:id/packages/:packageId/releases/:revision', registryPackageRelease)
    app.get('/api/registries/:id/packages/:packageId/skills/:skillId', registrySkill)
    app.get('/api/artifacts/skill/:digest', artifactDownload)
    app.get('/api/artifacts/icon/:digest', skillIcon)

    const registryResponse = await app.fetch(new Request('http://local/api/registries'))
    expect(registryResponse.status).toBe(200)
    expect((await registryResponse.json() as any).data[0]).toMatchObject({ id: 'example', skill_count: 1 })

    const searchResponse = await app.fetch(new Request('http://local/api/skills?q=%20demo%20&limit=1&sort=name'))
    expect(searchResponse.status).toBe(200)
    expect((await searchResponse.json() as any).data[0]).toMatchObject({
      registry_id: 'example', package_id: 'tools', skill_id: 'demo',
    })
    expect((await app.fetch(new Request('http://local/api/skills?registry=BAD'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?sort=recent'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?tag=one&tag=two'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?limit=101'))).status).toBe(400)

    const packagesResponse = await app.fetch(new Request('http://local/api/packages?q=%20tools%20&limit=1'))
    expect(packagesResponse.status).toBe(200)
    expect(await packagesResponse.json()).toMatchObject({
      total: 1,
      data: [{ registry_id: 'example', package_id: 'tools', name: 'tools', skill_count: 1 }],
    })
    expect((await app.fetch(new Request('http://local/api/packages?sort=package'))).status).toBe(400)
    const scopedPackages = await app.fetch(new Request('http://local/api/registries/example/packages'))
    expect(scopedPackages.status).toBe(200)
    const scopedPackageResult = await scopedPackages.json() as any
    expect(scopedPackageResult.total).toBe(1)
    expect((await app.fetch(new Request('http://local/api/registries/missing/packages'))).status).toBe(404)

    const packageResponse = await app.fetch(new Request('http://local/api/registries/example/packages/tools'))
    expect(packageResponse.status).toBe(200)
    const packageDescriptor = await packageResponse.json() as any
    expect(packageDescriptor).toMatchObject({
      registry_id: 'example', package_id: 'tools', revision: snapshot.packages[0]!.revision,
      skill_count: 1,
      release_url: `/api/registries/example/packages/tools/releases/${snapshot.packages[0]!.revision}`,
      postinstall,
      skills: [{ skill_id: 'demo', artifact: { digest } }],
    })
    const packageReleaseURL = `http://local${packageDescriptor.release_url}`
    const packageRelease = await app.fetch(new Request(packageReleaseURL))
    expect(packageRelease.headers.get('cache-control')).toContain('immutable')
    expect(packageRelease.headers.get('etag')).toBe(`"${snapshot.packages[0]!.revision}:tools"`)
    expect(packageRelease.headers.get('x-content-sha256')).toBe(snapshot.packages[0]!.revision)
    const packageReleaseBytes = new Uint8Array(await packageRelease.arrayBuffer())
    expect(await sha256(packageReleaseBytes)).toBe(snapshot.packages[0]!.revision)
    expect(JSON.parse(new TextDecoder().decode(packageReleaseBytes))).toMatchObject({
      postinstall,
      skills: [{ skill_id: 'demo', artifact: { digest } }],
    })
    expect((await app.fetch(new Request(packageReleaseURL, {
      headers: { 'if-none-match': `"${snapshot.packages[0]!.revision}:tools"` },
    }))).status).toBe(304)
    expect((await app.fetch(new Request(
      `http://local/api/registries/example/packages/tools/releases/${'0'.repeat(64)}`,
    ))).status).toBe(404)

    const scopedSkills = await app.fetch(new Request('http://local/api/registries/example/skills?q=demo'))
    expect(scopedSkills.status).toBe(200)
    expect((await scopedSkills.json() as any).total).toBe(1)

    const categoriesResponse = await app.fetch(new Request('http://local/api/registries/example/categories'))
    expect(categoriesResponse.status).toBe(200)
    expect((await categoriesResponse.json() as any).data).toEqual([{
      id: 'developer-tools', name: 'Developer Tools', count: 1,
      registries: [{ id: 'example', count: 1 }],
    }])
    expect((await app.fetch(new Request('http://local/api/registries/missing/skills'))).status).toBe(404)

    const detailResponse = await app.fetch(new Request('http://local/api/registries/example/packages/tools/skills/demo'))
    const detail = await detailResponse.json() as any
    expect(detail.artifact).toEqual({
      ...artifact,
      download_url: `/api/artifacts/skill/${digest}`,
    })
    expect(detail.icon.card).toEqual(image)
    const imageResponse = await app.fetch(new Request(`http://local/api/artifacts/icon/${detail.icon.card.digest}`))
    expect(imageResponse.headers.get('content-type')).toBe('image/svg+xml')
    expect(imageResponse.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(imageBytes)

    const downloadURL = `http://local${detail.artifact.download_url}`
    const downloadResponse = await app.fetch(new Request(downloadURL))
    expect(downloadResponse.headers.get('etag')).toBe(`"${digest}"`)
    expect(downloadResponse.headers.get('x-content-sha256')).toBe(digest)
    const downloaded = new Uint8Array(await downloadResponse.arrayBuffer())
    expect(await sha256(downloaded)).toBe(digest)
    const notModified = await app.fetch(new Request(downloadURL, { headers: { 'if-none-match': `"${digest}"` } }))
    expect(notModified.status).toBe(304)

    const destination = await mkdtemp(path.join(os.tmpdir(), 'registry-http-install-'))
    roots.push(destination)
    const installed = await extractSkillArchive(await parseGzipTarArchive(downloaded), destination, installID)
    expect(await readFile(path.join(installed, 'SKILL.md'), 'utf8')).toContain('name: Demo')
    expect((await stat(path.join(installed, 'scripts/run.sh'))).mode & 0o777).toBe(0o755)

    const updatedPostinstall: PackagePostinstallCommand[] = [
      { command: 'npm', args: ['install', '--global', 'opencli@2'] },
    ]
    const updatedSnapshot: SkillRegistrySnapshot = {
      ...snapshot,
      source: { ...snapshot.source, revision: 'f'.repeat(64) },
      packages: compactCatalogPackages([skill], new Map([['tools', { postinstall: updatedPostinstall }]])),
    }
    expect(updatedSnapshot.packages[0]!.revision).not.toBe(snapshot.packages[0]!.revision)
    await store.putPackageRelease(
      skillPackageReleaseFromSnapshotPackage(updatedSnapshot, updatedSnapshot.packages[0]!),
    )
    const updatedRevision = await store.publishSnapshot(serializeRegistrySnapshot(updatedSnapshot), definition, {
      publishedAt: '2026-01-03T00:00:00.000Z',
    })
    expect(updatedRevision).not.toBe(snapshotRevision)
    const updatedPackage = await app.fetch(new Request('http://local/api/registries/example/packages/tools'))
    expect(await updatedPackage.json()).toMatchObject({
      revision: updatedSnapshot.packages[0]!.revision,
      description: 'Demo Skill',
      postinstall: updatedPostinstall,
    })
    const historicalPackage = await app.fetch(new Request(packageReleaseURL))
    expect(await historicalPackage.json()).toMatchObject({
      description: 'Demo Skill',
      postinstall,
      skills: [{ artifact: { digest } }],
    })

    const stateRead = await store.getStateWithVersion('example')
    if (stateRead.versioning !== 'conditional') {
      throw new Error('Expected conditional Registry state versioning')
    }
    await store.putState({
      ...stateRead.state!,
      definition: { ...stateRead.state!.definition, enabled: false },
    }, stateRead.version)
    expect((await app.fetch(new Request(packageReleaseURL))).status).toBe(200)
    expect((await app.fetch(new Request('http://local/api/registries/example/packages/tools'))).status).toBe(404)

  })
})
