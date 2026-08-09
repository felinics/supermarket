import { describe, expect, test } from 'bun:test'
import type { CatalogSkill, SkillRegistrySnapshot } from './types'
import { compactCatalogPackages } from './snapshot'
import { catalogPackagesFromSnapshot, searchSkillPackages } from './packages'

function skill(overrides: Partial<CatalogSkill> = {}): CatalogSkill {
  return {
    schema_version: '1', registry_id: 'openai', registry_priority: 10,
    package_id: 'notion', skill_id: 'search', install_id: 'openai+notion+search',
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
    schema_version: '1', registry_id: registryID, registry_priority: priority,
    source: { type: 'git', revision: 'a'.repeat(40) },
    packages: compactCatalogPackages(skills),
    diagnostics: [],
  }
}

describe('Skill Packages', () => {
  test('reads stored Packages without merging the same ID across Registries', () => {
    const openai = snapshot([
      skill(),
      skill({ skill_id: 'write', install_id: 'openai+notion+write', name: 'Write Notion', tags: ['write'] }),
    ])
    const memohSkill = skill({ registry_id: 'memoh', install_id: 'memoh+notion+search', registry_priority: 100 })
    const packages = [
      ...catalogPackagesFromSnapshot(openai),
      ...catalogPackagesFromSnapshot(snapshot([memohSkill], 'memoh', 100)),
    ]
    expect(packages).toHaveLength(2)
    expect(packages.find((pkg) => pkg.registry_id === 'openai')).toMatchObject({
      package_id: 'notion', name: 'notion', skill_count: 2,
      tags: ['search', 'write'],
      categories: [{ id: 'productivity', name: 'Productivity', skill_count: 2 }],
    })
    expect(packages.find((pkg) => pkg.registry_id === 'memoh')).toMatchObject({ skill_count: 1 })
  })

  test('searches and filters at Package granularity', () => {
    const packages = catalogPackagesFromSnapshot(snapshot([
      skill(),
      skill({
        package_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design',
        name: 'Design in Figma', description: 'Create interface designs', tags: ['design'],
      }),
    ]))
    expect(searchSkillPackages(packages, { q: 'workspace' }).data.map((pkg) => pkg.package_id)).toEqual(['notion'])
    expect(searchSkillPackages(packages, { tag: 'design' }).data.map((pkg) => pkg.package_id)).toEqual(['figma'])
    expect(searchSkillPackages(packages, { category: 'productivity' }).total).toBe(2)
  })

  test('keeps a Package revision stable when another Package changes', () => {
    const before = snapshot([skill(), skill({
      package_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design',
    })])
    const after = snapshot([skill(), skill({
      package_id: 'figma', skill_id: 'design', install_id: 'openai+figma+design', description: 'Changed',
    })])
    expect(before.packages.find(item => item.package_id === 'notion')?.revision)
      .toBe(after.packages.find(item => item.package_id === 'notion')?.revision)
    expect(before.packages.find(item => item.package_id === 'figma')?.revision)
      .not.toBe(after.packages.find(item => item.package_id === 'figma')?.revision)
  })
})
