import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SkillRegistryDefinition } from '../types'
import type { PackageCandidate } from '../adapters/types'
import { parseCategoryTable } from '../categories'
import { buildSkillRegistryCandidate, validatePackageCandidates } from './candidate'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function writeSkill(root: string, relativePath: string, name: string) {
  const skillRoot = path.join(root, relativePath)
  await mkdir(skillRoot, { recursive: true })
  await writeFile(path.join(skillRoot, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`)
  return skillRoot
}

async function writeManifest(root: string, id: string, extra = '') {
  await mkdir(path.join(root, id), { recursive: true })
  await writeFile(path.join(root, id, 'package.yaml'), `schema_version: "2"
id: ${id}
version: 1.0.0
name: ${id}
description: ${id} package
category: other
${extra}`)
}

function packageCandidate(overrides: Partial<PackageCandidate> & { package_id: string }): PackageCandidate {
  return { reviewed: true, category: 'other', tags: [], dependencies: [], connectors: [], ...overrides }
}

const categories = parseCategoryTable({ schema_version: '1', categories: [
  { id: 'agent', name: { en: 'Agents', zh: '智能体' }, order: 10 },
  { id: 'other', name: { en: 'Other' }, order: 1000 },
] })

describe('Skill Registry candidates', () => {
  test('isolates Artifact packaging failures by Package', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-candidate-'))
    roots.push(projectRoot)
    const sourceRoot = path.join(projectRoot, 'registries/example/packages')
    await writeSkill(sourceRoot, 'good/skills/demo', 'Demo')
    await writeManifest(sourceRoot, 'good')
    await writeSkill(sourceRoot, 'bad/skills/a-valid', 'Valid')
    await writeManifest(sourceRoot, 'bad')
    const invalid = await writeSkill(sourceRoot, 'bad/skills/z-invalid', 'Invalid')
    await mkdir(path.join(invalid, 'scripts'))
    await writeFile(path.join(invalid, 'scripts/CON'), 'not portable')

    const definition: SkillRegistryDefinition = {
      schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10,
      adapter: { type: 'memoh' },
      source: { type: 'local', path: 'packages' },
    }
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot, { includeReview: true })

    expect(candidate.skills.map((skill) => `${skill.package_id}/${skill.skill_id}`)).toEqual(['good/demo'])
    expect(candidate.snapshot.packages).toHaveLength(1)
    expect(candidate.snapshot.packages[0]).toMatchObject({
      package_id: 'good', name: 'good', skills: [{ skill_id: 'demo' }],
    })
    expect(candidate.snapshot.packages[0]!.skills[0]).not.toHaveProperty('package_id')
    expect([...candidate.review.keys()]).toEqual(['good/demo'])
    expect(candidate.diagnostics).toHaveLength(1)
    expect(candidate.diagnostics[0]).toMatchObject({ package_id: 'bad', code: 'package_invalid' })
    expect(candidate.diagnostics[0]!.message).toContain('Unsafe tar path')
  })

  test('builds Snapshot categories and Package metadata from reviewed manifests', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-candidate-metadata-'))
    roots.push(projectRoot)
    await mkdir(path.join(projectRoot, 'registries'), { recursive: true })
    await writeFile(path.join(projectRoot, 'registries/categories.yaml'), `schema_version: "1"
categories:
  - { id: agent, name: { en: Agents, zh: 智能体, ja: エージェント }, order: 10 }
  - { id: other, name: { en: Other, zh: 其他, ja: その他 }, order: 1000 }
`)
    await mkdir(path.join(projectRoot, 'registries/memoh/dependencies/codex'), { recursive: true })
    const sourceRoot = path.join(projectRoot, 'registries/memoh/packages')
    await writeSkill(sourceRoot, 'codex/skills/codex-workflows', 'Workflows')
    await writeManifest(sourceRoot, 'codex', `dependencies: [codex]
connectors: [{ type: github, required: false }]
translations: { zh: { name: Codex 工具 } }
`)
    await writeFile(path.join(sourceRoot, 'codex/package.yaml'), (await Bun.file(path.join(sourceRoot, 'codex/package.yaml')).text()).replace('category: other', 'category: agent'))
    const definition: SkillRegistryDefinition = {
      schema_version: '1', id: 'memoh', name: 'Memoh', enabled: true, priority: 1000,
      adapter: { type: 'memoh' }, source: { type: 'local', path: 'packages' },
    }
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
    expect(candidate.snapshot.categories).toEqual([{ id: 'agent', name: { en: 'Agents', zh: '智能体', ja: 'エージェント' }, order: 10 }])
    expect(candidate.snapshot.packages[0]).toMatchObject({
      package_id: 'codex', version: '1.0.0', category: 'agent', category_name: 'Agents',
      dependencies: ['codex'], connectors: [{ type: 'github', required: false }],
      translations: { zh: { name: 'Codex 工具' } },
      skills: [{ skill_id: 'codex-workflows', category: 'agent', category_name: 'Agents' }],
    })
  })

  test('validates cross-resource Package references', () => {
    const definition: SkillRegistryDefinition = {
      schema_version: '1', id: 'memoh', name: 'Memoh', enabled: true, priority: 1000,
      adapter: { type: 'memoh' }, source: { type: 'local', path: 'packages' },
    }
    const dependencies = new Set(['codex'])
    const valid = new Map([['codex', packageCandidate({ package_id: 'codex', category: 'agent', dependencies: ['codex'] })]])
    expect(() => validatePackageCandidates(definition, { packages: valid }, categories, dependencies)).not.toThrow()

    const unknownCategory = new Map([['codex', packageCandidate({ package_id: 'codex', category: 'nope', dependencies: ['codex'] })]])
    expect(() => validatePackageCandidates(definition, { packages: unknownCategory }, categories, dependencies))
      .toThrow('unknown category "nope"')

    const unknownDependency = new Map([['codex', packageCandidate({ package_id: 'codex', dependencies: ['codex', 'missing'] })]])
    expect(() => validatePackageCandidates(definition, { packages: unknownDependency }, categories, dependencies))
      .toThrow('unknown dependency "missing"')

    const noCanonical = new Map([['tools', packageCandidate({ package_id: 'tools', dependencies: ['codex'] })]])
    expect(() => validatePackageCandidates(definition, { packages: noCanonical }, categories, dependencies))
      .toThrow('requires a package "codex"')

    const foreign = { ...definition, id: 'example' }
    const foreignReferences = new Map([['tools', packageCandidate({ package_id: 'tools', connectors: [{ type: 'github', required: true }] })]])
    expect(() => validatePackageCandidates(foreign, { packages: foreignReferences }, categories, new Set()))
      .toThrow('only supported in the memoh registry')
    expect(() => validatePackageCandidates(foreign, { packages: new Map() }, categories, new Set())).not.toThrow()
  })
})
