import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSkillCandidates } from './adapters'
import { RegistryBuildBudget, type RegistryBuildBudgetLimits } from './budget'
import type { SkillRegistryDefinition } from './types'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const definition: SkillRegistryDefinition = {
  schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 1,
  adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
}

function budget(overrides: Partial<RegistryBuildBudgetLimits> = {}) {
  return new RegistryBuildBudget({
    skills: 10, sourceFiles: 10, sourceBytes: 1_024, reviewTextBytes: 1_024,
    ...overrides,
  })
}

async function writeSkill(root: string, id: string) {
  const skillRoot = path.join(root, id)
  await mkdir(skillRoot, { recursive: true })
  await writeFile(path.join(skillRoot, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id}\n---\n`)
}

describe('Registry build budgets', () => {
  test('stops an adapter while it scans beyond the global Skill limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'registry-budget-skills-'))
    roots.push(root)
    await writeSkill(root, 'alpha')
    await writeSkill(root, 'beta')

    await expect(buildSkillCandidates({
      definition, sourceRoot: root, budget: budget({ skills: 1 }),
    })).rejects.toThrow('Registry exceeds 1 Skills')
  })

  test('enforces source file, source byte, review text, and canonical path budgets', () => {
    expect(() => budget({ sourceFiles: 1 }).addSourceFile('/source/two', 1)).not.toThrow()
    const files = budget({ sourceFiles: 1 })
    files.addSourceFile('/source/one', 1)
    expect(() => files.addSourceFile('/source/two', 1)).toThrow('exceeds 1 files')

    const bytes = budget({ sourceBytes: 2 })
    expect(() => bytes.addSourceFile('/source/large', 3)).toThrow('exceeds 2 bytes')

    const review = budget({ reviewTextBytes: 2 })
    review.addReviewText('one', 2)
    expect(() => review.addReviewText('two', 1)).toThrow('review text exceeds 2 bytes')

    const paths = budget()
    paths.addSourceFile('/source/caf\u00e9.md', 1)
    expect(() => paths.addSourceFile('/source/cafe\u0301.md', 1)).toThrow('Duplicate Registry source path')
  })
})
