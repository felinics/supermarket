import { describe, expect, test } from 'bun:test'
import type { Dirent } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildSkillCandidates } from '../adapters/index'
import { loadSkillRegistryDefinitions } from '../definitions/repository'
import { materializeSkillRegistrySource } from '../sources/index'
import { buildSkillRegistryCandidate, listDependencyIDs } from './candidate'

describe('Repository-owned Skill Registries', () => {
  test('discovers every Memoh Skill with its complete file set', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const sourceRoot = path.join(projectRoot, 'registries/memoh/apps')
    const apps = (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
    const expected = (await Promise.all(apps.flatMap(async (appEntry) => {
      const skillsRoot = path.join(sourceRoot, appEntry.name, 'skills')
      let skills: Dirent[]
      try {
        skills = await readdir(skillsRoot, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      skills = skills.filter((entry) => entry.isDirectory())
      return Promise.all(skills.map(async (skillEntry) => {
        await access(path.join(skillsRoot, skillEntry.name, 'SKILL.md'))
        return `${appEntry.name}/${skillEntry.name}`
      }))
    }))).flat().sort()
    const source = await materializeSkillRegistrySource(definition, projectRoot)
    const result = await buildSkillCandidates({ definition, sourceRoot: source.root })
    expect(result.skills.map((skill) => `${skill.app_id}/${skill.skill_id}`).sort()).toEqual(expected)
    expect(result.skills.every((skill) => Boolean(skill.files['SKILL.md']))).toBe(true)
    expect(result.skills.find((skill) => skill.skill_id === 'docx')?.files['scripts/accept_changes.py']?.mode).toBe(0o755)
    expect([...result.apps.keys()].sort()).toEqual(apps.map((entry) => entry.name).sort())
    expect([...result.apps.values()].every((pkg) => pkg.reviewed && pkg.version && pkg.category)).toBe(true)
  })

  test('publishes every pinned Connect-It connector as an independently authorizable App', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const upstream = JSON.parse(await readFile(path.join(projectRoot, 'registries/memoh/connect-it.catalog.json'), 'utf8')) as {
      connectors: { type: string; app_id: string }[]
    }
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
    const apps = candidate.snapshot.apps.filter((app) => app.connectors.length)
    expect(apps.flatMap((app) => app.connectors.map((ref) => ref.type)).sort())
      .toEqual(upstream.connectors.map((connector) => connector.type).sort())
    expect(new Set(upstream.connectors.map((connector) => connector.type)).size).toBe(upstream.connectors.length)
    expect(candidate.diagnostics).toEqual([])
    for (const connector of upstream.connectors) {
      const app = apps.find((item) => item.app_id === connector.app_id)!
      expect(app).toBeDefined()
      expect(app.connectors).toEqual([{ type: connector.type, required: true }])
      expect(app.skills).toEqual([])
      expect(app.dependencies).toEqual([])
      expect(app.category).not.toBe('other')
      expect(app.translations?.zh?.description).toBeTruthy()
      expect(app.translations?.ja?.description).toBeTruthy()
      expect(app.icon?.card).toBeDefined()
      expect(candidate.images.has(app.icon!.card!.digest)).toBe(true)
    }
  })

  test('publishes a canonical App for every official dependency', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
    const dependencyIDs = [...await listDependencyIDs(projectRoot)].sort()
    expect(dependencyIDs.length).toBeGreaterThan(0)
    for (const dependency of dependencyIDs) {
      const pkg = candidate.snapshot.apps.find((item) => item.app_id === dependency)
      expect(pkg).toBeDefined()
      expect(pkg!.dependencies).toContain(dependency)
      expect(pkg!.icon?.card).toBeDefined()
      expect(candidate.images.has(pkg!.icon!.card!.digest)).toBe(true)
    }
    expect(candidate.snapshot.categories.map((category) => category.id))
      .toEqual([...new Set(candidate.snapshot.apps.map((pkg) => pkg.category))]
        .sort((a, b) => candidate.snapshot.categories.findIndex((c) => c.id === a) - candidate.snapshot.categories.findIndex((c) => c.id === b)))
    expect(candidate.snapshot.categories.every((category) => category.name.zh && category.name.ja)).toBe(true)
  })
})
