import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  RegistryDiagnostic,
  SkillIcon,
  SkillImageAsset,
  SkillImageContentType,
} from '../types'
import { MAX_SKILL_IMAGE_BYTES } from '../types'
import { assertRegistryComponentID, safeRelativePath } from '../definition'
import { resolveRealInside } from '../filesystem'
import { compareCanonicalText } from '#lib/order'
import { sha256 } from '#lib/digest'
import { buildSkillCandidate, hasComponent } from './common'
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

const unsupportedPackageComponents = [
  'apps',
  'mcpServers',
  'hooks',
  'commands',
  'agents',
  'lspServers',
] as const

function declaredUnsupportedComponents(manifest: Record<string, unknown>) {
  return unsupportedPackageComponents.filter(component => hasComponent(manifest[component]))
}

function packageDiagnosticMessage(error: unknown, sourceRoot: string) {
  const message = error instanceof Error ? error.message : String(error)
  const roots = new Set([
    path.resolve(sourceRoot),
    path.resolve(sourceRoot).replaceAll(path.sep, '/'),
    path.resolve(sourceRoot).replaceAll(path.sep, '\\'),
  ])
  let stable = message
  for (const root of roots) stable = stable.replaceAll(root, '<source>')
  return `Skipped package: ${stable}`
}

function parseMarketplace(raw: unknown, budget: RegistryBuildBudget): MarketplaceEntry[] {
  if (!raw || typeof raw !== 'object') throw new Error('Codex Marketplace must contain a plugins array')
  const plugins = (raw as Record<string, unknown>).plugins
  if (!Array.isArray(plugins)) throw new Error('Codex Marketplace must contain a plugins array')
  budget.assertSkillEntries(plugins.length, 'Codex Marketplace')
  const names = new Set<string>()
  return plugins.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Marketplace package ${index} must be an object`)
    const item = value as Record<string, unknown>
    const name = assertRegistryComponentID(String(item.name ?? '').trim(), `package ${index} ID`)
    if (names.has(name)) throw new Error(`Marketplace contains duplicate package ID: ${name}`)
    names.add(name)
    return { name, category: item.category ? String(item.category) : undefined, source: item.source }
  })
}

function localPackagePath(source: unknown) {
  let value: string | undefined
  if (typeof source === 'string') value = source
  else if (source && typeof source === 'object') {
    const data = source as Record<string, unknown>
    if (data.source === 'local' && typeof data.path === 'string') value = data.path
  }
  return value ? safeRelativePath(value, 'Marketplace package path') : undefined
}

function codexSkillPaths(value: unknown) {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  if (values.length === 0 || values.some((item) => typeof item !== 'string')) {
    throw new Error('Codex package skills must be a path or an array of paths')
  }
  return [...new Set(values.map((item) => safeRelativePath(item as string, 'Codex skill path')))]
}

const imageTypes: Record<string, SkillImageContentType> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export function detectSkillImageContentType(bytes: Uint8Array): SkillImageContentType | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      .replace(/^\uFEFF/, '')
      .trimStart()
    if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)) {
      return 'image/svg+xml'
    }
  } catch {
    // Binary data is not SVG.
  }
  return undefined
}

function declaredImagePath(value: unknown, field: string) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a relative image path`)
  const relativePath = safeRelativePath(value, field)
  if (!imageTypes[path.extname(relativePath).toLowerCase()]) throw new Error(`${field} uses an unsupported image type`)
  return relativePath
}

async function readImageAsset(
  packageRoot: string,
  relativePath: string,
  budget: RegistryBuildBudget,
) {
  const target = await resolveRealInside(packageRoot, relativePath)
  const metadata = await stat(target)
  if (!metadata.isFile()) throw new Error(`Skill image ${relativePath} must be a regular file`)
  if (metadata.size > MAX_SKILL_IMAGE_BYTES) throw new OversizedSkillImageError(relativePath)
  const bytes = await readFileBounded(
    target,
    MAX_SKILL_IMAGE_BYTES,
    budget,
  )
  if (!bytes.length || bytes.length > MAX_SKILL_IMAGE_BYTES) {
    throw new Error(`Skill image ${relativePath} must be between 1 and ${MAX_SKILL_IMAGE_BYTES} bytes`)
  }
  const contentType = detectSkillImageContentType(bytes)
  const declaredType = imageTypes[path.extname(relativePath).toLowerCase()]!
  if (!contentType || contentType !== declaredType) {
    throw new Error(`Skill image ${relativePath} content does not match its file extension`)
  }
  const descriptor: SkillImageAsset = {
    digest: await sha256(bytes),
    size: bytes.length,
    content_type: contentType,
  }
  return { descriptor, bytes }
}

class OversizedSkillImageError extends Error {}

async function packageIcon(
  packageRoot: string,
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
      asset = await readImageAsset(packageRoot, imagePath, budget)
    } catch (error) {
      if (error instanceof OversizedSkillImageError) continue
      throw error
    }
    icon[kind] = asset.descriptor
    if (!assets.some((item) => item.descriptor.digest === asset.descriptor.digest)) assets.push(asset)
  }
  return { icon: Object.keys(icon).length ? icon : undefined, assets }
}

async function discoverSkillRoots(packageRoot: string, declaredPath: string) {
  const declaredRoot = await resolveRealInside(packageRoot, declaredPath)
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
  const candidates: Array<{ entry: MarketplaceEntry; packagePath: string }> = []
  for (const entry of entries) {
    const packagePath = localPackagePath(entry.source)
    if (!packagePath) {
      diagnostics.push({ package_id: entry.name, code: 'package_invalid', message: 'Skipped package: uses an unsupported source' })
      continue
    }
    candidates.push({ entry, packagePath })
  }
  await ensurePaths(candidates.map(({ packagePath }) => `${packagePath}/.codex-plugin/plugin.json`))

  const prepared: Array<{
    entry: MarketplaceEntry
    packagePath: string
    packageRoot: string
    manifest: Record<string, unknown>
    skillPaths: string[]
    iconPaths: string[]
  }> = []
  for (const item of candidates) {
    try {
      const packageRoot = await resolveRealInside(sourceRoot, item.packagePath)
      const manifestPath = await resolveRealInside(packageRoot, '.codex-plugin/plugin.json')
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
      prepared.push({ ...item, packageRoot, manifest, skillPaths, iconPaths })
    } catch (error) {
      rethrowRegistryBudgetError(error)
      diagnostics.push({
        package_id: item.entry.name,
        code: 'package_invalid',
        message: packageDiagnosticMessage(error, sourceRoot),
      })
    }
  }
  await ensurePaths(prepared.flatMap((item) => [
    ...item.skillPaths.map((skillPath) => `${item.packagePath}/${skillPath}`),
    ...item.iconPaths.map((iconPath) => `${item.packagePath}/${iconPath}`),
  ]))

  const skills: SkillCandidate[] = []
  for (const item of prepared) {
    try {
      const packageSkills: SkillCandidate[] = []
      const presentation = await packageIcon(item.packageRoot, item.manifest, budget)
      const seen = new Set<string>()
      const roots: Awaited<ReturnType<typeof discoverSkillRoots>> = []
      for (const skillPath of item.skillPaths) {
        for (const root of await discoverSkillRoots(item.packageRoot, skillPath)) {
          if (seen.has(root.id)) throw new Error(`duplicate skill ID ${root.id}`)
          seen.add(root.id)
          roots.push(root)
        }
      }
      for (const root of roots) {
        packageSkills.push(await buildSkillCandidate({
          definition,
          packageID: item.entry.name,
          skillID: root.id,
          sourcePath: `${item.packagePath}/${root.relativePath}`,
          root: root.root,
          allowedRoot: item.packageRoot,
          packageManifest: item.manifest,
          sourceCategory: item.entry.category,
          icon: presentation.icon,
          iconAssets: presentation.assets,
          budget,
        }))
      }
      skills.push(...packageSkills)
    } catch (error) {
      rethrowRegistryBudgetError(error)
      diagnostics.push({
        package_id: item.entry.name,
        code: 'package_invalid',
        message: packageDiagnosticMessage(error, sourceRoot),
      })
    }
  }
  return { skills, diagnostics, packageMetadata: new Map() }
}
