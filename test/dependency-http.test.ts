import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { H3 } from 'h3'
import { buildDependencyCandidate } from '#registry/dependencies/build'
import { DependencyRegistryStore } from '#registry/dependencies/store'
import { R2BlobBackend } from '#registry/storage/r2'
import { sha256 } from '#lib/digest'
import list from '#server/api/dependencies/index.get'
import current from '#server/api/registries/[id]/dependencies/[dependencyId].get'
import release from '#server/api/registries/[id]/dependencies/[dependencyId]/releases/[revision].get'
import artifact from '#server/api/artifacts/dependency/[digest].get'
import icon from '#server/api/artifacts/icon/[digest].get'

function bucketFixture() {
  const values = new Map<string, { bytes: Uint8Array; etag: string }>()
  let version = 0
  return {
    async get(key: string) {
      const value = values.get(key)
      return value ? { arrayBuffer: async () => value.bytes.slice().buffer as ArrayBuffer, size: value.bytes.length, etag: value.etag } : null
    },
    async put(key: string, bytes: Uint8Array, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      const existing = values.get(key)
      if (options?.onlyIf?.etagDoesNotMatch === '*' && existing) return null
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== existing?.etag) return null
      const etag = String(++version)
      values.set(key, { bytes: bytes.slice(), etag })
      return { etag }
    },
    async list() { return { objects: [], truncated: false } },
  }
}

describe('Dependency HTTP protocol', () => {
  test('serves the official catalog, verified releases, scripts and icons with immutable caching', async () => {
    const bucket = bucketFixture()
    const store = new DependencyRegistryStore(new R2BlobBackend(bucket))
    const candidate = await buildDependencyCandidate(path.resolve(import.meta.dirname, '..'))
    await store.publish(candidate)
    const app = new H3()
    app.use((event) => { (event.req as unknown as { runtime: unknown }).runtime = { cloudflare: { env: { SKILL_REGISTRY_BUCKET: bucket } } } })
    app.get('/api/dependencies', list)
    app.get('/api/registries/:id/dependencies/:dependencyId', current)
    app.get('/api/registries/:id/dependencies/:dependencyId/releases/:revision', release)
    app.get('/api/artifacts/dependency/:digest', artifact)
    app.get('/api/artifacts/icon/:digest', icon)
    const request = (url: string, headers?: HeadersInit) => app.fetch(new Request(`http://local${url}`, { headers }))
    const response = await request('/api/dependencies?registry=memoh&q=codex&limit=1')
    expect(response.status).toBe(200)
    const catalog = await response.json() as { total: number; data: Array<{ dependency_id: string }> }
    expect(catalog.total).toBe(1)
    expect(catalog.data[0]!.dependency_id).toBe('codex')
    for (const query of ['limit=999', 'page=0', 'page=1&page=2', 'q=a&q=b', 'category=wrong']) expect((await request(`/api/dependencies?${query}`)).status).toBe(400)
    expect((await request('/api/registries/third-party/dependencies/codex')).status).toBe(404)
    expect((await request('/api/registries/memoh/dependencies/missing')).status).toBe(404)
    const descriptor = candidate.snapshot.dependencies.find((item) => item.dependency_id === 'codex')!
    const currentDescriptor: unknown = await (await request('/api/registries/memoh/dependencies/codex')).json()
    expect(currentDescriptor).toEqual(descriptor)
    const releaseURL = `/api/registries/memoh/dependencies/codex/releases/${descriptor.revision}`
    const immutable = await request(releaseURL)
    expect(immutable.status).toBe(200)
    expect(await sha256(new Uint8Array(await immutable.arrayBuffer()))).toBe(descriptor.revision)
    expect(immutable.headers.get('cache-control')).toContain('immutable')
    expect((await request(releaseURL, { 'if-none-match': `"${descriptor.revision}"` })).status).toBe(304)
    const download = await request(`/api/artifacts/dependency/${descriptor.artifact.digest}`)
    expect(await sha256(new Uint8Array(await download.arrayBuffer()))).toBe(descriptor.artifact.digest)
    const iconDownload = await request(`/api/artifacts/icon/${descriptor.icon!.digest}`)
    expect(await sha256(new Uint8Array(await iconDownload.arrayBuffer()))).toBe(descriptor.icon!.digest)
    expect((await request('/api/artifacts/dependency/invalid')).status).toBe(400)
    await store.publish(candidate, false)
    expect((await request('/api/registries/memoh/dependencies/codex')).status).toBe(404)
    expect((await request(releaseURL)).status).toBe(200)
  })

  test('rejects a concurrent snapshot publisher instead of silently overwriting its state', async () => {
    const store = new DependencyRegistryStore(new R2BlobBackend(bucketFixture()))
    const candidate = await buildDependencyCandidate(path.resolve(import.meta.dirname, '..'))
    const results = await Promise.allSettled([store.publish(candidate), store.publish(candidate)])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('changed concurrently')
    expect((await store.current())!.revision).toBe(candidate.revision)
  })
})
