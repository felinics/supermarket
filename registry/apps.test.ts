import { describe, expect, test } from 'bun:test'
import type { CatalogSkill, SkillRegistrySnapshot } from './types'
import { compactCatalogApps } from './snapshot'
import { catalogAppsFromSnapshot, searchApps } from './apps'

function skill(overrides: Partial<CatalogSkill> = {}): CatalogSkill {
  return {
    schema_version: '2', registry_id: 'openai', registry_priority: 10,
    app_id: 'notion', skill_id: 'search', install_id: 'openai+notion+search',
    name: 'Search Notion', description: 'Search a workspace', author: { name: 'OpenAI', email: '' },
    tags: ['search'], category: 'productivity', category_name: 'Productivity',
    source: { type: 'git', revision: 'a'.repeat(40), path: 'notion/search' },
    files: ['SKILL.md'],
    artifact: {
      format: 'memoh_skill_v1', digest: 'b'.repeat(64), size: 100,
      uncompressed_size: 200, archive_size: 300, file_count: 1,
      content_type: 'application/gzip',
    },
    ...overrides,
  }
}

function snapshot(skills: CatalogSkill[], registryID = 'openai', priority = 10): SkillRegistrySnapshot {
  return {
    schema_version: '2', registry_id: registryID, registry_priority: priority,
    source: { type: 'git', revision: 'a'.repeat(40) },
    categories: [],
    apps: compactCatalogApps(skills),
    diagnostics: [],
  }
}

describe('Skill Apps', () => {
  test('reads stored Apps without merging the same ID across Registries', () => {
    const openai = snapshot([
      skill(),
      skill({ skill_id: 'write', install_id: 'openai+notion+write', name: 'Write Notion', tags: ['write'] }),
    ])
    const memohSkill = skill({ registry_id: 'memoh', install_id: 'memoh+notion+search', registry_priority: 100 })
    const apps = [
      ...catalogAppsFromSnapshot(openai),
      ...catalogAppsFromSnapshot(snapshot([memohSkill], 'memoh', 100)),
    ]
    expect(apps).toHaveLength(2)
    expect(apps.find((pkg) => pkg.registry_id === 'openai')).toMatchObject({
      app_id: 'notion', name: 'notion', skill_count: 2,
      tags: ['search', 'write'],
      categories: [{ id: 'productivity', name: 'Productivity', skill_count: 2 }],
    })
    expect(apps.find((pkg) => pkg.registry_id === 'memoh')).toMatchObject({ skill_count: 1 })
  })

  test('searches and filters at App granularity', () => {
    const apps = catalogAppsFromSnapshot(snapshot([
      skill(),
      skill({
        app_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design',
        name: 'Design in Figma', description: 'Create interface designs', tags: ['design'],
      }),
    ]))
    expect(searchApps(apps, { q: 'workspace' }).data.map((pkg) => pkg.app_id)).toEqual(['notion'])
    expect(searchApps(apps, { tag: 'design' }).data.map((pkg) => pkg.app_id)).toEqual(['figma'])
    expect(searchApps(apps, { category: 'productivity' }).total).toBe(2)
  })

  test('keeps an App revision stable when another App changes', () => {
    const before = snapshot([skill(), skill({
      app_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design',
    })])
    const after = snapshot([skill(), skill({
      app_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design', description: 'Changed',
    })])
    expect(before.apps.find(item => item.app_id === 'notion')?.revision)
      .toBe(after.apps.find(item => item.app_id === 'notion')?.revision)
    expect(before.apps.find(item => item.app_id === 'figma')?.revision)
      .not.toBe(after.apps.find(item => item.app_id === 'figma')?.revision)
  })
})
