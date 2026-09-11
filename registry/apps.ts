import type {
  CatalogSkill,
  AppComponent,
  SnapshotApp,
  AppDescriptor,
  AppRelease,
  AppSummary,
  SkillRegistrySnapshot,
} from './types'
import { catalogSkillsFromSnapshotApp, appMetadataFields } from './snapshot'

export interface AppSearchOptions {
  q?: string
  registry?: string
  category?: string
  tag?: string
  component?: AppComponent
  page?: number
  limit?: number
  sort?: 'relevance' | 'name' | 'registry'
}

export interface CatalogApp extends AppSummary {
  skills: CatalogSkill[]
}

function skillCategories(skills: Array<Pick<CatalogSkill, 'category' | 'category_name'>>) {
  const categories = new Map<string, { name: string; skill_count: number }>()
  for (const skill of skills) {
    const category = categories.get(skill.category) ?? { name: skill.category_name, skill_count: 0 }
    category.skill_count++
    categories.set(skill.category, category)
  }
  return [...categories.entries()].map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function appSummary(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotApp,
  skills: CatalogSkill[],
): CatalogApp {
  return {
    schema_version: '2',
    registry_id: snapshot.registry_id,
    registry_priority: snapshot.registry_priority,
    app_id: pkg.app_id,
    name: pkg.name,
    description: pkg.description,
    tags: pkg.tags,
    ...appMetadataFields(pkg),
    categories: skillCategories(skills),
    skill_count: skills.length,
    dependency_count: pkg.dependencies.length,
    connector_count: pkg.connectors.length,
    ...(pkg.icon ? { icon: pkg.icon } : {}),
    skills,
  }
}

export function catalogAppsFromSnapshot(snapshot: SkillRegistrySnapshot): CatalogApp[] {
  return snapshot.apps.map((pkg) => appSummary(
    snapshot,
    pkg,
    catalogSkillsFromSnapshotApp(snapshot, pkg),
  ))
}

function localizedTexts(pkg: CatalogApp) {
  return Object.values(pkg.translations ?? {}).flatMap((value) => [value?.name ?? '', value?.description ?? ''])
    .filter(Boolean).map((value) => value.toLowerCase())
}

function searchScore(pkg: CatalogApp, rawQuery: string) {
  const query = rawQuery.toLowerCase().trim()
  if (!query) return 0
  const localized = localizedTexts(pkg)
  if (pkg.app_id.toLowerCase() === query || pkg.name.toLowerCase() === query
    || localized.some((text) => text === query)) return 1000
  if (pkg.app_id.toLowerCase().startsWith(query) || pkg.name.toLowerCase().startsWith(query)) return 800
  if (pkg.tags.some((tag) => tag.toLowerCase() === query)
    || pkg.category === query || pkg.category_name.toLowerCase() === query
    || pkg.categories.some((category) => category.id === query || category.name.toLowerCase() === query)
    || pkg.dependencies.some((dependency) => dependency === query)
    || pkg.connectors.some((connector) => connector.type === query)) return 700
  if (pkg.tags.some((tag) => tag.toLowerCase().includes(query))
    || pkg.categories.some((category) => category.name.toLowerCase().includes(query))) return 600
  if (pkg.description.toLowerCase().includes(query)
    || localized.some((text) => text.includes(query))
    || pkg.skills.some((skill) => skill.name.toLowerCase().includes(query)
      || skill.skill_id.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query))) return 400
  return -1
}

function hasComponent(pkg: CatalogApp, component: AppComponent) {
  if (component === 'skills') return pkg.skill_count > 0
  if (component === 'dependencies') return pkg.dependency_count > 0
  return pkg.connector_count > 0
}

export function searchApps(all: CatalogApp[], options: AppSearchOptions = {}) {
  const apps = all.filter((pkg) => {
    if (options.registry && pkg.registry_id !== options.registry) return false
    if (options.category && pkg.category !== options.category
      && !pkg.categories.some((category) => category.id === options.category)) return false
    if (options.tag && !pkg.tags.some((tag) => tag.toLowerCase() === options.tag!.toLowerCase())) return false
    if (options.component && !hasComponent(pkg, options.component)) return false
    return true
  }).map((pkg) => ({ pkg, score: options.q ? searchScore(pkg, options.q) : 0 }))
    .filter(({ score }) => score >= 0)

  const sort = options.sort ?? 'relevance'
  apps.sort((a, b) => {
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
    total: apps.length,
    page,
    limit,
    data: apps.slice(start, start + limit).map(({ pkg }) => {
      const { skills: _skills, ...summary } = pkg
      return summary
    }),
  }
}

export function appDescriptorFromRelease(
  release: AppRelease,
  revision: string,
): AppDescriptor {
  return {
    ...release,
    revision,
    categories: skillCategories(release.skills),
    skill_count: release.skills.length,
    dependency_count: release.dependencies.length,
    connector_count: release.connectors.length,
  }
}
