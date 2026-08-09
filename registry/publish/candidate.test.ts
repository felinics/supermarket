import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SkillRegistryDefinition } from '../types'
import { buildSkillRegistryCandidate } from './candidate'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function writeSkill(root: string, relativePath: string, name: string) {
  const skillRoot = path.join(root, relativePath)
  await mkdir(skillRoot, { recursive: true })
  await writeFile(path.join(skillRoot, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`)
  return skillRoot
}

describe('Skill Registry candidates', () => {
  test('isolates Artifact packaging failures by Package', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-candidate-'))
    roots.push(projectRoot)
    const sourceRoot = path.join(projectRoot, 'registries/example/packages')
    await writeSkill(sourceRoot, 'good/skills/demo', 'Demo')
    await writeSkill(sourceRoot, 'bad/skills/a-valid', 'Valid')
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
})
