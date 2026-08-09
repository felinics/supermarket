import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { assertRegistryComponentID } from '../definition'
import { readFileBounded, resolveRealInside } from '../filesystem'
import { buildSkillCandidate } from './common'
import { compareCanonicalText } from '#lib/order'
import type { SkillAdapterInput, SkillAdapterResult, SkillCandidate } from './types'
import type { SkillPackageMetadata } from '../types'
import { MAX_PACKAGE_MANIFEST_BYTES, parseSkillPackageManifest } from '../package-manifest'

async function readPackageMetadata(
  packageRoot: string,
  registryID: string,
  packageID: string,
  budget: SkillAdapterInput['budget'],
): Promise<SkillPackageMetadata> {
  let manifestPath: string
  try {
    manifestPath = await resolveRealInside(packageRoot, 'package.yaml')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const bytes = await readFileBounded(manifestPath, MAX_PACKAGE_MANIFEST_BYTES, budget)
  return parseSkillPackageManifest(
    parseYaml(new TextDecoder().decode(bytes)),
    `${registryID}/${packageID}: package.yaml`,
  )
}

export async function readMemohRegistry(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, budget } = input
  const skills: SkillCandidate[] = []
  const packageMetadata = new Map<string, SkillPackageMetadata>()
  const packages = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareCanonicalText(a.name, b.name))

  for (const packageEntry of packages) {
    const packageID = assertRegistryComponentID(packageEntry.name, 'package ID')
    const packageRoot = await resolveRealInside(sourceRoot, packageID)
    const metadata = await readPackageMetadata(packageRoot, definition.id, packageID, budget)
    if (metadata.postinstall) packageMetadata.set(packageID, metadata)
    const skillsRoot = await resolveRealInside(packageRoot, 'skills')
    const entries = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => compareCanonicalText(a.name, b.name))
    if (!entries.length) throw new Error(`${definition.id}/${packageID}: package contains no skills`)

    for (const entry of entries) {
      const skillID = assertRegistryComponentID(entry.name, 'skill ID')
      const skillRoot = await resolveRealInside(skillsRoot, skillID)
      try {
        if (!(await stat(path.join(skillRoot, 'SKILL.md'))).isFile()) {
          throw new Error(`${definition.id}/${packageID}/${skillID}: missing SKILL.md`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`${definition.id}/${packageID}/${skillID}: missing SKILL.md`)
        }
        throw error
      }
      skills.push(await buildSkillCandidate({
        definition,
        packageID,
        skillID,
        sourcePath: `${packageID}/skills/${skillID}`,
        root: skillRoot,
        allowedRoot: packageRoot,
        budget,
      }))
    }
  }
  return { skills, diagnostics: [], packageMetadata }
}
