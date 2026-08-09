import type {
  CatalogSkill,
  SnapshotPackage,
  SkillPackageDescriptor,
  SkillPackageRelease,
  SkillPackageSummary,
  SkillRegistrySnapshot,
} from './types'
import { catalogSkillsFromSnapshotPackage } from './snapshot'

export interface SkillPackageSearchOptions {
  q?: string
  registry?: string
  category?: string
  tag?: string
  page?: number
  limit?: number
  sort?: 'relevance' | 'name' | 'registry'
}

export interface CatalogSkillPackage extends SkillPackageSummary {
  skills: CatalogSkill[]
}

function packageSummary(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotPackage,
  skills: CatalogSkill[],
): CatalogSkillPackage {
  const categories = new Map<string, { name: string; skill_count: number }>()
  for (const skill of skills) {
    const category = categories.get(skill.category) ?? { name: skill.category_name, skill_count: 0 }
    category.skill_count++
    categories.set(skill.category, category)
  }
  return {
    schema_version: '1',
    registry_id: snapshot.registry_id,
    registry_priority: snapshot.registry_priority,
    package_id: pkg.package_id,
    name: pkg.name,
    description: pkg.description,
    tags: pkg.tags,
    categories: [...categories.entries()].map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    skill_count: skills.length,
    ...(pkg.icon ? { icon: pkg.icon } : {}),
    skills,
  }
}

export function catalogPackagesFromSnapshot(snapshot: SkillRegistrySnapshot): CatalogSkillPackage[] {
  return snapshot.packages.map((pkg) => packageSummary(
    snapshot,
    pkg,
    catalogSkillsFromSnapshotPackage(snapshot, pkg),
  ))
}

function searchScore(pkg: CatalogSkillPackage, rawQuery: string) {
  const query = rawQuery.toLowerCase().trim()
  if (!query) return 0
  if (pkg.package_id.toLowerCase() === query || pkg.name.toLowerCase() === query) return 1000
  if (pkg.package_id.toLowerCase().startsWith(query) || pkg.name.toLowerCase().startsWith(query)) return 800
  if (pkg.tags.some((tag) => tag.toLowerCase() === query)
    || pkg.categories.some((category) => category.id === query || category.name.toLowerCase() === query)) return 700
  if (pkg.tags.some((tag) => tag.toLowerCase().includes(query))
    || pkg.categories.some((category) => category.name.toLowerCase().includes(query))) return 600
  if (pkg.description.toLowerCase().includes(query)
    || pkg.skills.some((skill) => skill.name.toLowerCase().includes(query)
      || skill.skill_id.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query))) return 400
  return -1
}

export function searchSkillPackages(all: CatalogSkillPackage[], options: SkillPackageSearchOptions = {}) {
  const packages = all.filter((pkg) => {
    if (options.registry && pkg.registry_id !== options.registry) return false
    if (options.category && !pkg.categories.some((category) => category.id === options.category)) return false
    if (options.tag && !pkg.tags.some((tag) => tag.toLowerCase() === options.tag!.toLowerCase())) return false
    return true
  }).map((pkg) => ({ pkg, score: options.q ? searchScore(pkg, options.q) : 0 }))
    .filter(({ score }) => score >= 0)

  const sort = options.sort ?? 'relevance'
  packages.sort((a, b) => {
    if (sort === 'relevance' && a.score !== b.score) return b.score - a.score
    if (sort === 'registry') {
      const result = a.pkg.registry_id.localeCompare(b.pkg.registry_id)
      if (result) return result
    }
    if (sort === 'name') {
      const result = a.pkg.name.localeCompare(b.pkg.name)
      if (result) return result
    }
    if (a.pkg.registry_priority !== b.pkg.registry_priority) return b.pkg.registry_priority - a.pkg.registry_priority
    return a.pkg.name.localeCompare(b.pkg.name) || a.pkg.registry_id.localeCompare(b.pkg.registry_id)
  })

  const page = Number.isFinite(options.page) ? Math.max(1, Math.trunc(options.page!)) : 1
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.trunc(options.limit!))) : 20
  const start = (page - 1) * limit
  return {
    total: packages.length,
    page,
    limit,
    data: packages.slice(start, start + limit).map(({ pkg }) => {
      const { skills: _skills, ...summary } = pkg
      return summary
    }),
  }
}

export function packageDescriptorFromRelease(
  release: SkillPackageRelease,
  revision: string,
): SkillPackageDescriptor {
  const categories = new Map<string, { name: string; skill_count: number }>()
  for (const skill of release.skills) {
    const current = categories.get(skill.category) ?? { name: skill.category_name, skill_count: 0 }
    current.skill_count++
    categories.set(skill.category, current)
  }
  return {
    ...release,
    revision,
    categories: [...categories.entries()].map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    skill_count: release.skills.length,
  }
}
