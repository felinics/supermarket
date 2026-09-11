import { parse as parseYaml } from 'yaml'
import type {
  SkillAuthor,
  SkillIcon,
  SkillImageAsset,
  SkillRegistryDefinition,
} from '../types'
import { normalizeSkillCategory } from '../catalog'
import { skillInstallID } from '../definition'
import { readDirectoryFiles, type SkillSourceFile } from '../filesystem'
import type { SkillCandidate } from './types'
import type { RegistryBuildBudget } from '../budget'

function uniqueStrings(...values: unknown[]) {
  const output = new Set<string>()
  for (const value of values) {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
    for (const item of items) {
      const text = String(item).trim()
      if (text) output.add(text)
    }
  }
  return [...output]
}

function normalizeAuthor(value: unknown, fallback?: SkillAuthor): SkillAuthor {
  if (typeof value === 'string') {
    const text = value.trim()
    const match = text.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/)
    return { name: match?.[1]?.trim() || text || fallback?.name || '', email: match?.[2] || fallback?.email || '' }
  }
  if (!value || typeof value !== 'object') return fallback ?? { name: '', email: '' }
  const author = value as Record<string, unknown>
  const name = String(author.name ?? '').trim() || fallback?.name || ''
  const email = String(author.email ?? '').trim() || fallback?.email || ''
  return { name, email }
}

function parseSkill(files: Record<string, SkillSourceFile>, fallbackID: string) {
  const manifest = files['SKILL.md']
  if (!manifest) throw new Error(`Skill ${fallbackID} is missing SKILL.md`)
  const text = new TextDecoder().decode(manifest.bytes)
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) throw new Error(`Skill ${fallbackID} is missing YAML frontmatter`)
  const data = parseYaml(frontmatter[1]!)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Skill ${fallbackID} YAML frontmatter must be an object`)
  }
  return { data, metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {} }
}

export function hasComponent(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export async function buildSkillCandidate(input: {
  definition: SkillRegistryDefinition
  appID: string
  skillID: string
  sourcePath: string
  root: string
  allowedRoot: string
  appManifest?: Record<string, unknown>
  icon?: SkillIcon
  iconAssets?: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }>
  sourceCategory?: string
  budget: RegistryBuildBudget
}): Promise<SkillCandidate> {
  const {
    definition, appID, skillID, sourcePath, root, allowedRoot,
    appManifest = {}, sourceCategory, icon, iconAssets, budget,
  } = input
  budget.addSkill(`${definition.id}/${appID}/${skillID}`)
  const files = await readDirectoryFiles(root, allowedRoot, budget)
  const { data, metadata } = parseSkill(files, skillID)
  const appAuthor = normalizeAuthor(appManifest.author)
  const category = normalizeSkillCategory(
    String(metadata.category ?? data.category ?? sourceCategory ?? '').trim() || undefined,
  )
  return {
    app_id: appID,
    skill_id: skillID,
    install_id: skillInstallID(definition.id, appID, skillID),
    name: String(data.name ?? skillID),
    description: String(data.description ?? ''),
    author: normalizeAuthor(metadata.author, appAuthor),
    homepage: metadata.homepage ? String(metadata.homepage) : appManifest.homepage ? String(appManifest.homepage) : undefined,
    tags: uniqueStrings(metadata.tags, data.tags, appManifest.keywords),
    category: category.id,
    category_name: category.name,
    source_category: category.sourceName,
    source_path: sourcePath,
    files,
    icon,
    icon_assets: iconAssets,
  }
}
