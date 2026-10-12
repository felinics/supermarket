import { stat } from 'node:fs/promises'
import path from 'node:path'
import { assertRegistryComponentID } from '../definition'
import { resolveRealInside } from '../filesystem'
import { buildSkillCandidate } from './common'
import type { SkillAdapterInput, SkillAdapterResult } from './types'

export async function readSkillPack(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, budget } = input
  if (definition.adapter.type !== 'skill_pack') throw new Error(`${definition.id}: expected skill_pack adapter`)
  const { app, skills: skillPaths } = definition.adapter
  const seen = new Set<string>()
  const skills = []
  for (const skillPath of skillPaths) {
    const skillID = assertRegistryComponentID(path.posix.basename(skillPath), `${definition.id}: skill ID`)
    if (seen.has(skillID)) throw new Error(`${definition.id}: duplicate skill ID ${skillID}`)
    seen.add(skillID)
    const label = `${definition.id}/${app.id}/${skillID}`
    const root = await skillDirectory(sourceRoot, skillPath, label)
    skills.push(await buildSkillCandidate({
      definition,
      appID: app.id,
      skillID,
      sourcePath: skillPath,
      root,
      allowedRoot: root,
      appManifest: {
        author: app.author,
        homepage: app.homepage,
        keywords: app.tags,
      },
      sourceCategory: app.category,
      budget,
    }))
  }
  return {
    skills,
    diagnostics: [],
    apps: new Map([[app.id, {
      app_id: app.id,
      reviewed: true,
      ...(app.version ? { version: app.version } : {}),
      name: app.name,
      description: app.description,
      ...(app.author ? { author: app.author } : {}),
      ...(app.homepage ? { homepage: app.homepage } : {}),
      ...(app.repository ? { repository: app.repository } : {}),
      ...(app.license ? { license: app.license } : {}),
      category: app.category,
      tags: app.tags,
      ...(app.translations ? { translations: app.translations } : {}),
      dependencies: [],
      connectors: [],
    }]]),
  }
}

async function skillDirectory(sourceRoot: string, skillPath: string, label: string) {
  let root: string
  try {
    root = await resolveRealInside(sourceRoot, skillPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label}: missing SKILL.md`)
    throw error
  }
  try {
    if (!(await stat(path.join(root, 'SKILL.md'))).isFile()) throw new Error(`${label}: SKILL.md must be a regular file`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label}: missing SKILL.md`)
    throw error
  }
  return root
}
