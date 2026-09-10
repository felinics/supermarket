import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { assertRegistryComponentID } from '../definition'
import { readFileBounded, resolveRealInside } from '../filesystem'
import { buildSkillCandidate } from './common'
import { declaredImagePath, readImageAsset } from './images'
import { compareCanonicalText } from '#lib/order'
import type { PackageCandidate, SkillAdapterInput, SkillAdapterResult, SkillCandidate } from './types'
import type { PackageManifest, SkillIcon } from '../types'
import { MAX_PACKAGE_MANIFEST_BYTES, parsePackageManifest } from '../package-manifest'

export const PACKAGE_MANIFEST_FILE = 'package.yaml'

async function readPackageManifest(
  packageRoot: string,
  registryID: string,
  packageID: string,
  budget: SkillAdapterInput['budget'],
): Promise<PackageManifest> {
  const label = `${registryID}/${packageID}: ${PACKAGE_MANIFEST_FILE}`
  let manifestPath: string
  try {
    manifestPath = await resolveRealInside(packageRoot, PACKAGE_MANIFEST_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label} is required`)
    throw error
  }
  const bytes = await readFileBounded(manifestPath, MAX_PACKAGE_MANIFEST_BYTES, budget)
  const manifest = parsePackageManifest(parseYaml(new TextDecoder().decode(bytes)), label)
  if (manifest.id !== packageID) throw new Error(`${label}: id must match the package directory`)
  return manifest
}

async function readPackageIcon(
  packageRoot: string,
  manifest: PackageManifest,
  label: string,
  budget: SkillAdapterInput['budget'],
) {
  if (!manifest.icon) return { icon: undefined, assets: [] }
  const relativePath = declaredImagePath(manifest.icon, `${label}.icon`)!
  const asset = await readImageAsset(packageRoot, relativePath, budget)
  const icon: SkillIcon = { card: asset.descriptor, detail: asset.descriptor }
  return { icon, assets: [asset] }
}

async function listSkillDirectories(packageRoot: string) {
  let skillsRoot: string
  try {
    skillsRoot = await resolveRealInside(packageRoot, 'skills')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { skillsRoot: undefined, entries: [] }
    throw error
  }
  if (!(await stat(skillsRoot)).isDirectory()) throw new Error(`${packageRoot}: skills must be a directory`)
  const entries = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareCanonicalText(a.name, b.name))
  return { skillsRoot, entries }
}

export async function readMemohRegistry(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, budget } = input
  const skills: SkillCandidate[] = []
  const packages = new Map<string, PackageCandidate>()
  const packageEntries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareCanonicalText(a.name, b.name))

  for (const packageEntry of packageEntries) {
    const packageID = assertRegistryComponentID(packageEntry.name, 'package ID')
    const label = `${definition.id}/${packageID}`
    const packageRoot = await resolveRealInside(sourceRoot, packageID)
    const manifest = await readPackageManifest(packageRoot, definition.id, packageID, budget)
    const presentation = await readPackageIcon(packageRoot, manifest, `${label}: ${PACKAGE_MANIFEST_FILE}`, budget)
    const { skillsRoot, entries } = await listSkillDirectories(packageRoot)
    const packageSkills: SkillCandidate[] = []
    for (const entry of entries) {
      const skillID = assertRegistryComponentID(entry.name, 'skill ID')
      const skillRoot = await resolveRealInside(skillsRoot!, skillID)
      try {
        if (!(await stat(path.join(skillRoot, 'SKILL.md'))).isFile()) {
          throw new Error(`${label}/${skillID}: missing SKILL.md`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`${label}/${skillID}: missing SKILL.md`)
        }
        throw error
      }
      packageSkills.push(await buildSkillCandidate({
        definition,
        packageID,
        skillID,
        sourcePath: `${packageID}/skills/${skillID}`,
        root: skillRoot,
        allowedRoot: packageRoot,
        packageManifest: {
          author: manifest.author,
          homepage: manifest.homepage,
          keywords: manifest.tags,
        },
        sourceCategory: manifest.category,
        icon: presentation.icon,
        iconAssets: presentation.assets,
        budget,
      }))
    }
    if (!packageSkills.length && !manifest.dependencies.length && !manifest.connectors.length) {
      throw new Error(`${label}: package declares no skills, dependencies or connectors`)
    }
    skills.push(...packageSkills)
    packages.set(packageID, {
      package_id: packageID,
      reviewed: true,
      version: manifest.version,
      name: manifest.name,
      description: manifest.description,
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
      ...(manifest.repository ? { repository: manifest.repository } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      category: manifest.category,
      tags: manifest.tags,
      ...(manifest.translations ? { translations: manifest.translations } : {}),
      dependencies: manifest.dependencies,
      connectors: manifest.connectors,
      ...(manifest.postinstall ? { postinstall: manifest.postinstall } : {}),
      ...(presentation.icon ? { icon: presentation.icon, icon_assets: presentation.assets } : {}),
    })
  }
  return { skills, diagnostics: [], packages }
}
