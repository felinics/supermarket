import { describe, expect, test } from 'bun:test'
import type { Dirent } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { buildSkillCandidates } from '../adapters/index'
import { loadSkillRegistryDefinitions } from '../definitions/repository'
import { materializeSkillRegistrySource } from '../sources/index'
import { buildSkillRegistryCandidate, listDependencyIDs } from './candidate'

describe('Repository-owned Skill Registries', () => {
  test('discovers every Memoh Skill with its complete file set', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const sourceRoot = path.join(projectRoot, 'registries/memoh/packages')
    const packages = (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
    const expected = (await Promise.all(packages.flatMap(async (packageEntry) => {
      const skillsRoot = path.join(sourceRoot, packageEntry.name, 'skills')
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
        return `${packageEntry.name}/${skillEntry.name}`
      }))
    }))).flat().sort()
    const source = await materializeSkillRegistrySource(definition, projectRoot)
    const result = await buildSkillCandidates({ definition, sourceRoot: source.root })
    expect(result.skills.map((skill) => `${skill.package_id}/${skill.skill_id}`).sort()).toEqual(expected)
    expect(result.skills.every((skill) => Boolean(skill.files['SKILL.md']))).toBe(true)
    expect(result.skills.find((skill) => skill.skill_id === 'docx')?.files['scripts/accept_changes.py']?.mode).toBe(0o755)
    expect([...result.packages.keys()].sort()).toEqual(packages.map((entry) => entry.name).sort())
    expect([...result.packages.values()].every((pkg) => pkg.reviewed && pkg.version && pkg.category)).toBe(true)
  })

  test('publishes a canonical Package for every official dependency', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
    const dependencyIDs = [...await listDependencyIDs(projectRoot)].sort()
    expect(dependencyIDs.length).toBeGreaterThan(0)
    for (const dependency of dependencyIDs) {
      const pkg = candidate.snapshot.packages.find((item) => item.package_id === dependency)
      expect(pkg).toBeDefined()
      expect(pkg!.dependencies).toContain(dependency)
      expect(pkg!.icon?.card).toBeDefined()
      expect(candidate.images.has(pkg!.icon!.card!.digest)).toBe(true)
    }
    expect(candidate.snapshot.categories.map((category) => category.id))
      .toEqual([...new Set(candidate.snapshot.packages.map((pkg) => pkg.category))]
        .sort((a, b) => candidate.snapshot.categories.findIndex((c) => c.id === a) - candidate.snapshot.categories.findIndex((c) => c.id === b)))
    expect(candidate.snapshot.categories.every((category) => category.name.zh && category.name.ja)).toBe(true)
  })
})
