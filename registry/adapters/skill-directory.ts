import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { assertRegistryComponentID } from '../definition'
import { resolveRealInside } from '../filesystem'
import { buildSkillCandidate } from './common'
import { compareCanonicalText } from '#lib/order'
import type { SkillAdapterInput, SkillAdapterResult, SkillCandidate } from './types'

export async function readSkillDirectory(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, budget } = input
  const skills: SkillCandidate[] = []
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  entries.sort((a, b) => compareCanonicalText(a.name, b.name))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      if (!(await stat(path.join(sourceRoot, entry.name, 'SKILL.md'))).isFile()) {
        throw new Error(`Skill ${entry.name} SKILL.md must be a regular file`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const id = assertRegistryComponentID(entry.name, 'skill ID')
    skills.push(await buildSkillCandidate({
      definition, packageID: id, skillID: id, sourcePath: id,
      root: await resolveRealInside(sourceRoot, id), allowedRoot: sourceRoot,
      budget,
    }))
  }
  return { skills, diagnostics: [], packageMetadata: new Map() }
}
