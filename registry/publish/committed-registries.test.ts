import { describe, expect, test } from 'bun:test'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { buildSkillCandidates } from '../adapters/index'
import { loadSkillRegistryDefinitions } from '../definitions/repository'
import { materializeSkillRegistrySource } from '../sources/index'

describe('Repository-owned Skill Registries', () => {
  test('discovers every Memoh Skill with its complete file set', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../..')
    const definition = (await loadSkillRegistryDefinitions(projectRoot)).find((item) => item.id === 'memoh')!
    const sourceRoot = path.join(projectRoot, 'registries/memoh/packages')
    const packages = (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
    const expected = (await Promise.all(packages.flatMap(async (packageEntry) => {
      const skillsRoot = path.join(sourceRoot, packageEntry.name, 'skills')
      const skills = (await readdir(skillsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
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
  })
})
