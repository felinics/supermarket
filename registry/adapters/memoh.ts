import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { assertRegistryComponentID } from '../definition'
import { readFileBounded, resolveRealInside } from '../filesystem'
import { buildSkillCandidate } from './common'
import { declaredImagePath, readImageAsset } from './images'
import { compareCanonicalText } from '#lib/order'
import type { AppCandidate, SkillAdapterInput, SkillAdapterResult, SkillCandidate } from './types'
import type { AppManifest, SkillIcon } from '../types'
import { MAX_APP_MANIFEST_BYTES, parseAppManifest } from '../app-manifest'

export const APP_MANIFEST_FILE = 'app.yaml'

async function readAppManifest(
  appRoot: string,
  registryID: string,
  appID: string,
  budget: SkillAdapterInput['budget'],
): Promise<AppManifest> {
  const label = `${registryID}/${appID}: ${APP_MANIFEST_FILE}`
  let manifestPath: string
  try {
    manifestPath = await resolveRealInside(appRoot, APP_MANIFEST_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label} is required`)
    throw error
  }
  const bytes = await readFileBounded(manifestPath, MAX_APP_MANIFEST_BYTES, budget)
  const manifest = parseAppManifest(parseYaml(new TextDecoder().decode(bytes)), label)
  if (manifest.id !== appID) throw new Error(`${label}: id must match the app directory`)
  return manifest
}

async function readAppIcon(
  appRoot: string,
  manifest: AppManifest,
  label: string,
  budget: SkillAdapterInput['budget'],
) {
  if (!manifest.icon) return { icon: undefined, assets: [] }
  const relativePath = declaredImagePath(manifest.icon, `${label}.icon`)!
  const asset = await readImageAsset(appRoot, relativePath, budget)
  const icon: SkillIcon = { card: asset.descriptor, detail: asset.descriptor }
  return { icon, assets: [asset] }
}

async function listSkillDirectories(appRoot: string) {
  let skillsRoot: string
  try {
    skillsRoot = await resolveRealInside(appRoot, 'skills')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { skillsRoot: undefined, entries: [] }
    throw error
  }
  if (!(await stat(skillsRoot)).isDirectory()) throw new Error(`${appRoot}: skills must be a directory`)
  const entries = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareCanonicalText(a.name, b.name))
  return { skillsRoot, entries }
}

export async function readMemohRegistry(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, budget } = input
  const skills: SkillCandidate[] = []
  const apps = new Map<string, AppCandidate>()
  const appEntries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareCanonicalText(a.name, b.name))

  for (const appEntry of appEntries) {
    const appID = assertRegistryComponentID(appEntry.name, 'app ID')
    const label = `${definition.id}/${appID}`
    const appRoot = await resolveRealInside(sourceRoot, appID)
    const manifest = await readAppManifest(appRoot, definition.id, appID, budget)
    const presentation = await readAppIcon(appRoot, manifest, `${label}: ${APP_MANIFEST_FILE}`, budget)
    const { skillsRoot, entries } = await listSkillDirectories(appRoot)
    const appSkills: SkillCandidate[] = []
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
      appSkills.push(await buildSkillCandidate({
        definition,
        appID,
        skillID,
        sourcePath: `${appID}/skills/${skillID}`,
        root: skillRoot,
        allowedRoot: appRoot,
        appManifest: {
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
    if (!appSkills.length && !manifest.dependencies.length && !manifest.connectors.length) {
      throw new Error(`${label}: app declares no skills, dependencies or connectors`)
    }
    skills.push(...appSkills)
    apps.set(appID, {
      app_id: appID,
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
  return { skills, diagnostics: [], apps }
}
