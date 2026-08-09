import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SkillRegistryDefinition, SkillRegistrySnapshot } from '#registry/types'
import { LocalSkillRegistryStore } from '#registry/storage/local'
import { summarizeCurrentSnapshot } from '#registry/catalog'
import { serializeRegistrySnapshot } from '#registry/snapshot'
import {
  getEnabledSkillRegistrySnapshots,
  getSkillRegistryDetailsForStore,
  getRuntimeSkillRegistryStore,
  getSkillRegistrySummariesForStore,
} from './skill-registry'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const definition: SkillRegistryDefinition = {
  schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10,
  adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
}

function snapshot(): SkillRegistrySnapshot {
  return {
    schema_version: '1',
    registry_id: 'example',
    registry_priority: 10,
    source: { type: 'local', revision: 'source' },
    packages: [],
    diagnostics: [],
  }
}

describe('Skill Registry loader', () => {
  test('fails explicitly when a Cloudflare runtime has no R2 binding', async () => {
    await expect(getRuntimeSkillRegistryStore({ req: { runtime: { cloudflare: { env: {} } } } }))
      .rejects.toThrow('SKILL_REGISTRY_BUCKET')
  })

  test('does not expose a disabled Registry through snapshots, summaries, or details', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-registry-loader-'))
    roots.push(root)
    const store = new LocalSkillRegistryStore(root)
    const approved = snapshot()
    const revision = await store.publishSnapshot(serializeRegistrySnapshot(approved), definition, {
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(await getEnabledSkillRegistrySnapshots(store)).toEqual([approved])

    await store.putState({
      schema_version: '1',
      definition: { ...definition, enabled: false },
      current_snapshot: revision,
      current_summary: summarizeCurrentSnapshot(approved, revision, '2026-01-01T00:00:00.000Z'),
    })
    expect(await getEnabledSkillRegistrySnapshots(store)).toEqual([])
    expect(await getEnabledSkillRegistrySnapshots(store, definition.id)).toEqual([])
    await expect(getSkillRegistrySummariesForStore(store)).resolves.toEqual([])
    await expect(getSkillRegistryDetailsForStore(store, 'example')).resolves.toBeUndefined()
  })

})
