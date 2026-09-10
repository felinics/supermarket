import type {
  CatalogSkill,
  PackageCategorySummary,
  SkillCategorySummary,
  SkillRegistryCurrentSummary,
  SkillRegistrySnapshot,
} from './types'
import { catalogSkillsFromSnapshot } from './snapshot'
import { slugifyCategory } from './categories'
import { compareCanonicalText } from '#lib/order'

function categoryName(value: string) {
  if (!/^[a-z0-9-]+$/.test(value)) return value
  return value.split('-').filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function normalizeSkillCategory(value?: string) {
  const sourceName = value?.trim() || undefined
  if (!sourceName) return { id: 'other', name: 'Other' }
  const id = slugifyCategory(sourceName)
  if (!id) return { id: 'other', name: 'Other', sourceName }
  return { id, name: categoryName(sourceName), sourceName }
}

function searchScore(skill: CatalogSkill, rawQuery: string) {
  const query = rawQuery.toLowerCase().trim()
  if (!query) return 0
  const id = skill.skill_id.toLowerCase()
  const name = skill.name.toLowerCase()
  const packageID = skill.package_id.toLowerCase()
  if (id === query) return 1000
  if (name === query) return 950
  if (packageID === query) return 900
  if (id.startsWith(query) || name.startsWith(query)) return 800
  const terms = [...skill.tags, skill.category, skill.category_name, skill.registry_id, packageID].map((item) => item.toLowerCase())
  if (terms.some((item) => item === query)) return 700
  if (terms.some((item) => item.includes(query))) return 600
  if (name.includes(query) || id.includes(query)) return 500
  if (skill.description.toLowerCase().includes(query)) return 400
  return -1
}

export interface SkillCatalogSearchOptions {
  q?: string
  registry?: string
  package?: string
  category?: string
  tag?: string
  page?: number
  limit?: number
  sort?: 'relevance' | 'name' | 'registry' | 'package'
}

export function searchCatalogSkills(all: CatalogSkill[], options: SkillCatalogSearchOptions = {}) {
  const matches = all.filter((skill) => {
    if (options.registry && skill.registry_id !== options.registry) return false
    if (options.package && skill.package_id !== options.package) return false
    if (options.category && skill.category !== options.category.toLowerCase()) return false
    if (options.tag && !skill.tags.some((tag) => tag.toLowerCase() === options.tag!.toLowerCase())) return false
    return true
  }).map((skill) => ({ skill, score: options.q ? searchScore(skill, options.q) : 0 }))
    .filter(({ score }) => score >= 0)

  const sort = options.sort ?? 'relevance'
  matches.sort((a, b) => {
    if (sort === 'relevance' && a.score !== b.score) return b.score - a.score
    if (sort === 'registry') {
      const result = a.skill.registry_id.localeCompare(b.skill.registry_id)
      if (result) return result
    }
    if (sort === 'package') {
      const result = a.skill.package_id.localeCompare(b.skill.package_id)
      if (result) return result
    }
    if (sort === 'name') {
      const result = a.skill.name.localeCompare(b.skill.name)
      if (result) return result
    }
    if (a.skill.registry_priority !== b.skill.registry_priority) return b.skill.registry_priority - a.skill.registry_priority
    return a.skill.name.localeCompare(b.skill.name)
      || a.skill.registry_id.localeCompare(b.skill.registry_id)
      || a.skill.package_id.localeCompare(b.skill.package_id)
  })

  const page = Number.isFinite(options.page) ? Math.max(1, Math.trunc(options.page!)) : 1
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.trunc(options.limit!))) : 20
  const start = (page - 1) * limit
  return { total: matches.length, page, limit, data: matches.slice(start, start + limit).map(({ skill }) => skill) }
}

export function summarizeSkillCategories(skills: CatalogSkill[]): SkillCategorySummary[] {
  const categories = new Map<string, { name: string; registries: Map<string, number>; count: number }>()
  for (const skill of skills) {
    const current = categories.get(skill.category) ?? { name: skill.category_name, registries: new Map(), count: 0 }
    current.count++
    current.registries.set(skill.registry_id, (current.registries.get(skill.registry_id) ?? 0) + 1)
    categories.set(skill.category, current)
  }
  return [...categories.entries()].map(([id, value]) => ({
    id, name: value.name, count: value.count,
    registries: [...value.registries].map(([registry, count]) => ({ id: registry, count })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Package-level categories across Snapshots. Localized names come from the
 * Snapshot category tables; a Package whose category is missing from its
 * Snapshot table falls back to the English name it recorded.
 */
export function summarizePackageCategories(snapshots: SkillRegistrySnapshot[]): PackageCategorySummary[] {
  const categories = new Map<string, PackageCategorySummary & { registryCounts: Map<string, number> }>()
  for (const snapshot of snapshots) {
    const table = new Map((snapshot.categories ?? []).map((category) => [category.id, category]))
    for (const pkg of snapshot.packages) {
      const definition = table.get(pkg.category)
      let current = categories.get(pkg.category)
      if (!current) {
        current = {
          id: pkg.category,
          name: definition?.name.en ?? pkg.category_name,
          names: definition ? { ...definition.name } : { en: pkg.category_name },
          order: definition?.order ?? 100_000,
          package_count: 0,
          registries: [],
          registryCounts: new Map(),
        }
        categories.set(pkg.category, current)
      }
      current.package_count++
      current.registryCounts.set(snapshot.registry_id, (current.registryCounts.get(snapshot.registry_id) ?? 0) + 1)
    }
  }
  return [...categories.values()].map(({ registryCounts, ...summary }) => ({
    ...summary,
    registries: [...registryCounts].map(([id, count]) => ({ id, count })).sort((a, b) => compareCanonicalText(a.id, b.id)),
  })).sort((a, b) => a.order - b.order || compareCanonicalText(a.id, b.id))
}

export function summarizeCurrentSnapshot(
  snapshot: SkillRegistrySnapshot,
  revision: string,
  publishedAt: string,
): SkillRegistryCurrentSummary {
  return {
    revision,
    source_revision: snapshot.source.revision,
    published_at: publishedAt,
    skill_count: snapshot.packages.reduce((total, pkg) => total + pkg.skills.length, 0),
    package_count: snapshot.packages.length,
    category_count: new Set(snapshot.packages.map((pkg) => pkg.category)).size,
    skipped_package_count: new Set(snapshot.diagnostics.map((item) => item.package_id).filter(Boolean)).size,
  }
}

export { catalogSkillsFromSnapshot }
