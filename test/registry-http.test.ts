import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { H3 } from 'h3'
import { extractSkillArchive, parseGzipTarArchive } from '../client/archive'
import artifactDownload from '../server/api/artifacts/skill/[digest].get'
import skillIcon from '../server/api/artifacts/icon/[digest].get'
import apps from '../server/api/apps/index.get'
import registryApp from '../server/api/registries/[id]/apps/[appId].get'
import registryAppRelease from '../server/api/registries/[id]/apps/[appId]/releases/[revision].get'
import registryApps from '../server/api/registries/[id]/apps/index.get'
import registrySkill from '../server/api/registries/[id]/apps/[appId]/skills/[skillId].get'
import categories from '../server/api/categories.get'
import registrySkills from '../server/api/registries/[id]/skills/index.get'
import registries from '../server/api/registries/index.get'
import skills from '../server/api/skills/index.get'
import type {
  CatalogSkill,
  AppPostinstallCommand,
  SkillArtifactDescriptor,
  SkillRegistryDefinition,
  SkillRegistrySnapshot,
} from '#registry/types'
import {
  compactCatalogApps,
  serializeRegistrySnapshot,
  appReleaseFromSnapshotApp,
  snapshotCategoriesFor,
} from '#registry/snapshot'
import { parseCategoryTable } from '#registry/categories'
import type { AppCandidate } from '#registry/adapters/types'
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
      schema_version: '2', registry_id: 'example', registry_priority: 10,
      app_id: 'tools', skill_id: 'demo', install_id: installID,
      name: 'Demo', description: 'Demo Skill', author: { name: 'Test', email: '' },
      tags: ['demo'], category: 'developer-tools', category_name: 'Developer Tools',
      source: { type: 'local', revision: sourceRevision, path: 'skills/demo' },
      files: ['SKILL.md', 'scripts/run.sh'], icon: { card: image, detail: image, brand_color: '#0B7285' }, artifact,
    }
    const postinstall: AppPostinstallCommand[] = [
      { command: 'npm', args: ['install', '--global', 'opencli'] },
    ]
    const categoryTable = parseCategoryTable({ schema_version: '1', categories: [
      { id: 'developer-tools', name: { en: 'Developer Tools', zh: '开发工具' }, order: 40 },
      { id: 'other', name: { en: 'Other' }, order: 1000 },
    ] })
    const appCandidate = (commands: AppPostinstallCommand[]): AppCandidate => ({
      app_id: 'tools', reviewed: false, tags: [], dependencies: [], connectors: [], postinstall: commands,
    })
    const snapshotApps = compactCatalogApps([skill], {
      apps: new Map([['tools', appCandidate(postinstall)]]), categories: categoryTable,
    })
    const snapshot: SkillRegistrySnapshot = {
      schema_version: '2', registry_id: 'example', registry_priority: 10,
      source: { type: 'local', revision: sourceRevision },
      categories: snapshotCategoriesFor(snapshotApps, categoryTable),
      apps: snapshotApps,
      diagnostics: [],
    }
    await store.putArtifact(artifact, archive)
    await store.putImage(image, imageBytes)
    await store.putAppRelease(
      appReleaseFromSnapshotApp(snapshot, snapshot.apps[0]!),
    )
    const snapshotRevision = await store.publishSnapshot(serializeRegistrySnapshot(snapshot), definition, {
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    const app = new H3()
    app.use((event) => { (event.req as any).runtime = { cloudflare: { env: { SKILL_REGISTRY_BUCKET: bucket } } } })
    app.get('/api/registries', registries)
    app.get('/api/skills', skills)
    app.get('/api/apps', apps)
    app.get('/api/categories', categories)
    app.get('/api/registries/:id/skills', registrySkills)
    app.get('/api/registries/:id/apps', registryApps)
    app.get('/api/registries/:id/apps/:appId', registryApp)
    app.get('/api/registries/:id/apps/:appId/releases/:revision', registryAppRelease)
    app.get('/api/registries/:id/apps/:appId/skills/:skillId', registrySkill)
    app.get('/api/artifacts/skill/:digest', artifactDownload)
    app.get('/api/artifacts/icon/:digest', skillIcon)

    const registryResponse = await app.fetch(new Request('http://local/api/registries'))
    expect(registryResponse.status).toBe(200)
    expect((await registryResponse.json() as any).data[0]).toMatchObject({ id: 'example', skill_count: 1 })

    const searchResponse = await app.fetch(new Request('http://local/api/skills?q=%20demo%20&limit=1&sort=name'))
    expect(searchResponse.status).toBe(200)
    expect((await searchResponse.json() as any).data[0]).toMatchObject({
      registry_id: 'example', app_id: 'tools', skill_id: 'demo',
    })
    expect((await app.fetch(new Request('http://local/api/skills?registry=BAD'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?sort=recent'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?tag=one&tag=two'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/skills?limit=101'))).status).toBe(400)

    const appsResponse = await app.fetch(new Request('http://local/api/apps?q=%20tools%20&limit=1'))
    expect(appsResponse.status).toBe(200)
    expect(await appsResponse.json()).toMatchObject({
      total: 1,
      data: [{
        registry_id: 'example', app_id: 'tools', name: 'tools', skill_count: 1,
        category: 'developer-tools', category_name: 'Developer Tools', dependency_count: 0, connector_count: 0,
      }],
    })
    expect((await app.fetch(new Request('http://local/api/apps?sort=app'))).status).toBe(400)
    const scopedApps = await app.fetch(new Request('http://local/api/registries/example/apps'))
    expect(scopedApps.status).toBe(200)
    const scopedAppResult = await scopedApps.json() as any
    expect(scopedAppResult.total).toBe(1)
    expect((await app.fetch(new Request('http://local/api/registries/missing/apps'))).status).toBe(404)

    const appResponse = await app.fetch(new Request('http://local/api/registries/example/apps/tools'))
    expect(appResponse.status).toBe(200)
    const appDescriptor = await appResponse.json() as any
    expect(appDescriptor).toMatchObject({
      registry_id: 'example', app_id: 'tools', revision: snapshot.apps[0]!.revision,
      skill_count: 1,
      release_url: `/api/registries/example/apps/tools/releases/${snapshot.apps[0]!.revision}`,
      postinstall,
      skills: [{ skill_id: 'demo', artifact: { digest } }],
    })
    const appReleaseURL = `http://local${appDescriptor.release_url}`
    const appRelease = await app.fetch(new Request(appReleaseURL))
    expect(appRelease.headers.get('cache-control')).toContain('immutable')
    expect(appRelease.headers.get('etag')).toBe(`"${snapshot.apps[0]!.revision}:tools"`)
    expect(appRelease.headers.get('x-content-sha256')).toBe(snapshot.apps[0]!.revision)
    const appReleaseBytes = new Uint8Array(await appRelease.arrayBuffer())
    expect(await sha256(appReleaseBytes)).toBe(snapshot.apps[0]!.revision)
    expect(JSON.parse(new TextDecoder().decode(appReleaseBytes))).toMatchObject({
      postinstall,
      skills: [{ skill_id: 'demo', artifact: { digest } }],
    })
    expect((await app.fetch(new Request(appReleaseURL, {
      headers: { 'if-none-match': `"${snapshot.apps[0]!.revision}:tools"` },
    }))).status).toBe(304)
    expect((await app.fetch(new Request(
      `http://local/api/registries/example/apps/tools/releases/${'0'.repeat(64)}`,
    ))).status).toBe(404)

    const scopedSkills = await app.fetch(new Request('http://local/api/registries/example/skills?q=demo'))
    expect(scopedSkills.status).toBe(200)
    expect((await scopedSkills.json() as any).total).toBe(1)

    const categoriesResponse = await app.fetch(new Request('http://local/api/categories?registry=example'))
    expect(categoriesResponse.status).toBe(200)
    expect((await categoriesResponse.json() as any).data).toEqual([{
      id: 'developer-tools', name: 'Developer Tools', names: { en: 'Developer Tools', zh: '开发工具' }, order: 40,
      app_count: 1, registries: [{ id: 'example', count: 1 }],
    }])
    expect((await (await app.fetch(new Request('http://local/api/categories'))).json() as any).data).toHaveLength(1)
    expect((await app.fetch(new Request('http://local/api/categories?registry=missing'))).status).toBe(404)
    expect((await app.fetch(new Request('http://local/api/apps?component=dependencies'))).status).toBe(200)
    expect((await (await app.fetch(new Request('http://local/api/apps?component=dependencies'))).json() as any).total).toBe(0)
    expect((await app.fetch(new Request('http://local/api/apps?component=hooks'))).status).toBe(400)
    expect((await app.fetch(new Request('http://local/api/registries/missing/skills'))).status).toBe(404)

    const detailResponse = await app.fetch(new Request('http://local/api/registries/example/apps/tools/skills/demo'))
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

    const updatedPostinstall: AppPostinstallCommand[] = [
      { command: 'npm', args: ['install', '--global', 'opencli@2'] },
    ]
    const updatedSnapshot: SkillRegistrySnapshot = {
      ...snapshot,
      source: { ...snapshot.source, revision: 'f'.repeat(64) },
      apps: compactCatalogApps([skill], {
        apps: new Map([['tools', appCandidate(updatedPostinstall)]]), categories: categoryTable,
      }),
    }
    expect(updatedSnapshot.apps[0]!.revision).not.toBe(snapshot.apps[0]!.revision)
    await store.putAppRelease(
      appReleaseFromSnapshotApp(updatedSnapshot, updatedSnapshot.apps[0]!),
    )
    const updatedRevision = await store.publishSnapshot(serializeRegistrySnapshot(updatedSnapshot), definition, {
      publishedAt: '2026-01-03T00:00:00.000Z',
    })
    expect(updatedRevision).not.toBe(snapshotRevision)
    const updatedApp = await app.fetch(new Request('http://local/api/registries/example/apps/tools'))
    expect(await updatedApp.json()).toMatchObject({
      revision: updatedSnapshot.apps[0]!.revision,
      description: 'Demo Skill',
      postinstall: updatedPostinstall,
    })
    const historicalApp = await app.fetch(new Request(appReleaseURL))
    expect(await historicalApp.json()).toMatchObject({
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
    expect((await app.fetch(new Request(appReleaseURL))).status).toBe(200)
    expect((await app.fetch(new Request('http://local/api/registries/example/apps/tools'))).status).toBe(404)

  })
})
