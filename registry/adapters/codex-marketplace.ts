import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  RegistryDiagnostic,
  SkillIcon,
  SkillImageAsset,
} from '../types'
import { assertRegistryComponentID, safeRelativePath } from '../definition'
import { resolveRealInside } from '../filesystem'
import { compareCanonicalText } from '#lib/order'
import { buildSkillCandidate, hasComponent } from './common'
import { OversizedSkillImageError, declaredImagePath, readImageAsset } from './images'
import type { SkillAdapterInput, SkillAdapterResult, SkillCandidate } from './types'
import {
  MAX_REGISTRY_METADATA_FILE_BYTES,
  rethrowRegistryBudgetError,
  type RegistryBuildBudget,
} from '../budget'
import { readFileBounded } from '../filesystem'

interface MarketplaceEntry {
  name: string
  category?: string
  source: unknown
}

const unsupportedAppComponents = [
  'apps',
  'mcpServers',
  'hooks',
  'commands',
  'agents',
  'lspServers',
] as const

function declaredUnsupportedComponents(manifest: Record<string, unknown>) {
  return unsupportedAppComponents.filter(component => hasComponent(manifest[component]))
}

function appDiagnosticMessage(error: unknown, sourceRoot: string) {
  const message = error instanceof Error ? error.message : String(error)
  const roots = new Set([
    path.resolve(sourceRoot),
    path.resolve(sourceRoot).replaceAll(path.sep, '/'),
    path.resolve(sourceRoot).replaceAll(path.sep, '\\'),
  ])
  let stable = message
  for (const root of roots) stable = stable.replaceAll(root, '<source>')
  return `Skipped app: ${stable}`
}

function parseMarketplace(raw: unknown, budget: RegistryBuildBudget): MarketplaceEntry[] {
  if (!raw || typeof raw !== 'object') throw new Error('Codex Marketplace must contain a plugins array')
  const plugins = (raw as Record<string, unknown>).plugins
  if (!Array.isArray(plugins)) throw new Error('Codex Marketplace must contain a plugins array')
  budget.assertSkillEntries(plugins.length, 'Codex Marketplace')
  const names = new Set<string>()
  return plugins.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Marketplace app ${index} must be an object`)
    const item = value as Record<string, unknown>
    const name = assertRegistryComponentID(String(item.name ?? '').trim(), `app ${index} ID`)
    if (names.has(name)) throw new Error(`Marketplace contains duplicate app ID: ${name}`)
    names.add(name)
    return { name, category: item.category ? String(item.category) : undefined, source: item.source }
  })
}

function localAppPath(source: unknown) {
  let value: string | undefined
  if (typeof source === 'string') value = source
  else if (source && typeof source === 'object') {
    const data = source as Record<string, unknown>
    if (data.source === 'local' && typeof data.path === 'string') value = data.path
  }
  return value ? safeRelativePath(value, 'Marketplace app path') : undefined
}

function codexSkillPaths(value: unknown) {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  if (values.length === 0 || values.some((item) => typeof item !== 'string')) {
    throw new Error('Codex app skills must be a path or an array of paths')
  }
  return [...new Set(values.map((item) => safeRelativePath(item as string, 'Codex skill path')))]
}


async function appIcon(
  appRoot: string,
  manifest: Record<string, unknown>,
  budget: RegistryBuildBudget,
) {
  const ui = manifest.interface && typeof manifest.interface === 'object'
    ? manifest.interface as Record<string, unknown>
    : {}
  const paths = {
    card: declaredImagePath(ui.composerIcon, 'interface.composerIcon'),
    detail: declaredImagePath(ui.logo, 'interface.logo'),
    dark: declaredImagePath(ui.logoDark, 'interface.logoDark'),
  }
  const brandColor = typeof ui.brandColor === 'string' && /^#[0-9a-f]{6}$/i.test(ui.brandColor)
    ? ui.brandColor.toUpperCase()
    : undefined
  const icon: SkillIcon = {}
  if (brandColor) icon.brand_color = brandColor
  const assets: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }> = []
  for (const [kind, imagePath] of Object.entries(paths) as Array<[keyof typeof paths, string | undefined]>) {
    if (!imagePath) continue
    let asset
    try {
      asset = await readImageAsset(appRoot, imagePath, budget)
    } catch (error) {
      if (error instanceof OversizedSkillImageError) continue
      throw error
    }
    icon[kind] = asset.descriptor
    if (!assets.some((item) => item.descriptor.digest === asset.descriptor.digest)) assets.push(asset)
  }
  return { icon: Object.keys(icon).length ? icon : undefined, assets }
}

async function discoverSkillRoots(appRoot: string, declaredPath: string) {
  const declaredRoot = await resolveRealInside(appRoot, declaredPath)
  try {
    if (!(await stat(path.join(declaredRoot, 'SKILL.md'))).isFile()) {
      throw new Error(`Codex skill path "${declaredPath}" SKILL.md must be a regular file`)
    }
    return [{ id: assertRegistryComponentID(path.posix.basename(declaredPath), 'skill ID'), root: declaredRoot, relativePath: declaredPath }]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const entries = await readdir(declaredRoot, { withFileTypes: true })
  const roots: Array<{ id: string; root: string; relativePath: string }> = []
  for (const entry of entries.sort((a, b) => compareCanonicalText(a.name, b.name))) {
    if (!entry.isDirectory()) continue
    const root = await resolveRealInside(declaredRoot, entry.name)
    try {
      if (!(await stat(path.join(root, 'SKILL.md'))).isFile()) continue
      roots.push({ id: assertRegistryComponentID(entry.name, 'skill ID'), root, relativePath: `${declaredPath}/${entry.name}` })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!roots.length) throw new Error(`Codex skill path "${declaredPath}" contains no SKILL.md`)
  return roots
}

export async function readCodexMarketplace(input: SkillAdapterInput): Promise<SkillAdapterResult> {
  const { definition, sourceRoot, ensurePaths, budget } = input
  if (definition.adapter.type !== 'codex_marketplace_skills') {
    throw new Error(`${definition.id}: expected codex_marketplace_skills adapter`)
  }
  const catalogPath = await resolveRealInside(sourceRoot, definition.adapter.catalog_path)
  const catalogBytes = await readFileBounded(catalogPath, MAX_REGISTRY_METADATA_FILE_BYTES, budget)
  const entries = parseMarketplace(JSON.parse(new TextDecoder().decode(catalogBytes)), budget)

  const diagnostics: RegistryDiagnostic[] = []
  const candidates: Array<{ entry: MarketplaceEntry; appPath: string }> = []
  for (const entry of entries) {
    const appPath = localAppPath(entry.source)
    if (!appPath) {
      diagnostics.push({ app_id: entry.name, code: 'app_invalid', message: 'Skipped app: uses an unsupported source' })
      continue
    }
    candidates.push({ entry, appPath })
  }
  await ensurePaths(candidates.map(({ appPath }) => `${appPath}/.codex-plugin/plugin.json`))

  const prepared: Array<{
    entry: MarketplaceEntry
    appPath: string
    appRoot: string
    manifest: Record<string, unknown>
    skillPaths: string[]
    iconPaths: string[]
  }> = []
  for (const item of candidates) {
    try {
      const appRoot = await resolveRealInside(sourceRoot, item.appPath)
      const manifestPath = await resolveRealInside(appRoot, '.codex-plugin/plugin.json')
      const manifestBytes = await readFileBounded(manifestPath, MAX_REGISTRY_METADATA_FILE_BYTES, budget)
      const parsed = JSON.parse(new TextDecoder().decode(manifestBytes))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('manifest must be an object')
      }
      const manifest = parsed as Record<string, unknown>
      if (String(manifest.name ?? '') !== item.entry.name) {
        throw new Error('manifest name does not match its Marketplace entry')
      }
      if (!hasComponent(manifest.skills)) {
        continue
      }
      const unsupported = declaredUnsupportedComponents(manifest)
      if (unsupported.length) {
        throw new Error(`declares unsupported components alongside Skills: ${unsupported.join(', ')}`)
      }
      const skillPaths = codexSkillPaths(manifest.skills)
      const ui = manifest.interface && typeof manifest.interface === 'object'
        ? manifest.interface as Record<string, unknown>
        : {}
      const iconPaths = [
        declaredImagePath(ui.composerIcon, 'interface.composerIcon'),
        declaredImagePath(ui.logo, 'interface.logo'),
        declaredImagePath(ui.logoDark, 'interface.logoDark'),
      ].filter((value): value is string => Boolean(value))
      prepared.push({ ...item, appRoot, manifest, skillPaths, iconPaths })
    } catch (error) {
      rethrowRegistryBudgetError(error)
      diagnostics.push({
        app_id: item.entry.name,
        code: 'app_invalid',
        message: appDiagnosticMessage(error, sourceRoot),
      })
    }
  }
  await ensurePaths(prepared.flatMap((item) => [
    ...item.skillPaths.map((skillPath) => `${item.appPath}/${skillPath}`),
    ...item.iconPaths.map((iconPath) => `${item.appPath}/${iconPath}`),
  ]))

  const skills: SkillCandidate[] = []
  for (const item of prepared) {
    try {
      const appSkills: SkillCandidate[] = []
      const presentation = await appIcon(item.appRoot, item.manifest, budget)
      const seen = new Set<string>()
      const roots: Awaited<ReturnType<typeof discoverSkillRoots>> = []
      for (const skillPath of item.skillPaths) {
        for (const root of await discoverSkillRoots(item.appRoot, skillPath)) {
          if (seen.has(root.id)) throw new Error(`duplicate skill ID ${root.id}`)
          seen.add(root.id)
          roots.push(root)
        }
      }
      for (const root of roots) {
        appSkills.push(await buildSkillCandidate({
          definition,
          appID: item.entry.name,
          skillID: root.id,
          sourcePath: `${item.appPath}/${root.relativePath}`,
          root: root.root,
          allowedRoot: item.appRoot,
          appManifest: item.manifest,
          sourceCategory: item.entry.category,
          icon: presentation.icon,
          iconAssets: presentation.assets,
          budget,
        }))
      }
      skills.push(...appSkills)
    } catch (error) {
      rethrowRegistryBudgetError(error)
      diagnostics.push({
        app_id: item.entry.name,
        code: 'app_invalid',
        message: appDiagnosticMessage(error, sourceRoot),
      })
    }
  }
  return { skills, diagnostics, apps: new Map() }
}

export { detectSkillImageContentType } from './images'
