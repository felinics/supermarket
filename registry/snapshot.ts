import { createHash } from 'node:crypto'
import { skillInstallID } from './definition'
import type {
  CatalogSkill,
  SkillIcon,
  AppRelease,
  AppReleaseSkill,
  AppMetadata,
  SnapshotCategory,
  SnapshotApp,
  SkillRegistrySnapshot,
  SnapshotSkill,
} from './types'
import type { AppCandidate } from './adapters/types'
import { CategoryTable, defaultCategoryTable } from './categories'
import { compareCanonicalText } from '#lib/order'

const encoder = new TextEncoder()

export function serializeRegistrySnapshot(snapshot: SkillRegistrySnapshot): Uint8Array {
  return encoder.encode(`${JSON.stringify(snapshot, null, 2)}\n`)
}

export function registrySnapshotRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function serializeAppRelease(release: AppRelease): Uint8Array {
  return encoder.encode(`${JSON.stringify(release, null, 2)}\n`)
}

export function appRevision(release: AppRelease): string {
  return registrySnapshotRevision(serializeAppRelease(release))
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function compactCatalogSkill(skill: CatalogSkill): SnapshotSkill {
  return {
    skill_id: skill.skill_id,
    name: skill.name,
    description: skill.description,
    author: skill.author.email ? skill.author : { name: skill.author.name },
    ...(skill.homepage ? { homepage: skill.homepage } : {}),
    tags: skill.tags,
    category: skill.category,
    category_name: skill.category_name,
    ...(skill.source_category ? { source_category: skill.source_category } : {}),
    source_path: skill.source.path,
    files: skill.files,
    ...(skill.icon ? { icon: skill.icon } : {}),
    artifact: {
      digest: skill.artifact.digest,
      size: skill.artifact.size,
      uncompressed_size: skill.artifact.uncompressed_size,
      archive_size: skill.artifact.archive_size,
      file_count: skill.artifact.file_count,
    },
  }
}

function copyPostinstall(metadata?: Pick<AppMetadata, 'postinstall'>) {
  return metadata?.postinstall?.map(({ command, args }) => ({ command, args: [...args] }))
}

function copyTranslations(translations: NonNullable<AppMetadata['translations']>) {
  const copy: NonNullable<AppMetadata['translations']> = {}
  for (const locale of ['en', 'zh', 'ja'] as const) {
    const value = translations[locale]
    if (!value) continue
    const entry: { name?: string; description?: string } = {}
    if (value.name) entry.name = value.name
    if (value.description) entry.description = value.description
    if (Object.keys(entry).length) copy[locale] = entry
  }
  return copy
}

/**
 * Copies App metadata in a fixed key order so Snapshot entries and
 * immutable releases serialize identically.
 */
export function appMetadataFields(source: AppMetadata): AppMetadata {
  const translations = source.translations ? copyTranslations(source.translations) : undefined
  return {
    ...(source.version ? { version: source.version } : {}),
    ...(source.author ? { author: { name: source.author.name, email: source.author.email ?? '' } } : {}),
    ...(source.homepage ? { homepage: source.homepage } : {}),
    ...(source.repository ? { repository: source.repository } : {}),
    ...(source.license ? { license: source.license } : {}),
    category: source.category,
    category_name: source.category_name,
    ...(translations && Object.keys(translations).length ? { translations } : {}),
    dependencies: [...(source.dependencies ?? [])],
    connectors: (source.connectors ?? []).map(({ type, required }) => ({ type, required })),
    ...(source.postinstall ? { postinstall: copyPostinstall(source) } : {}),
  }
}

type AppShape = AppMetadata & {
  app_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
}

function buildAppRelease(
  registryID: string,
  pkg: AppShape,
  skills: AppReleaseSkill[],
): AppRelease {
  return {
    schema_version: '2',
    registry_id: registryID,
    app_id: pkg.app_id,
    name: pkg.name,
    description: pkg.description,
    tags: [...pkg.tags],
    ...(pkg.icon ? { icon: pkg.icon } : {}),
    ...appMetadataFields(pkg),
    skills,
  }
}

function dominantCategory(skills: CatalogSkill[]) {
  const counts = new Map<string, number>()
  for (const skill of skills) {
    const key = skill.source_category ?? skill.category
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

export interface CompactAppsOptions {
  /** Required when an App has no Skills, otherwise inferred from them. */
  registry?: string
  apps?: ReadonlyMap<string, AppCandidate>
  categories?: CategoryTable
}

export function compactCatalogApps(
  skills: CatalogSkill[],
  options: CompactAppsOptions = {},
): SnapshotApp[] {
  const apps = options.apps ?? new Map<string, AppCandidate>()
  const categories = options.categories ?? defaultCategoryTable()
  const groups = new Map<string, CatalogSkill[]>()
  for (const skill of skills) {
    const group = groups.get(skill.app_id) ?? []
    group.push(skill)
    groups.set(skill.app_id, group)
  }
  const appIDs = [...new Set([...groups.keys(), ...apps.keys()])].sort(compareCanonicalText)
  const registryID = options.registry ?? skills[0]?.registry_id
  return appIDs.map((appID) => {
    if (!registryID) throw new Error(`App ${appID}: registry ID is required`)
    const candidate = apps.get(appID)
    const ordered = [...(groups.get(appID) ?? [])].sort((a, b) => compareCanonicalText(a.skill_id, b.skill_id))
    const representative = ordered.find((skill) => skill.skill_id === appID) ?? ordered[0]
    const category = candidate?.reviewed && candidate.category
      ? categories.require(candidate.category, `${registryID}/${appID}`)
      : categories.resolve(candidate?.category ?? dominantCategory(ordered))
    const metadata: AppMetadata = {
      version: candidate?.version,
      author: candidate?.author,
      homepage: candidate?.homepage ?? representative?.homepage,
      repository: candidate?.repository,
      license: candidate?.license,
      category: category.id,
      category_name: category.name.en,
      translations: candidate?.translations,
      dependencies: candidate?.dependencies ?? [],
      connectors: candidate?.connectors ?? [],
      postinstall: candidate?.postinstall,
    }
    const shape: AppShape = {
      ...appMetadataFields(metadata),
      app_id: appID,
      name: candidate?.name ?? appID,
      description: candidate?.description ?? representative?.description ?? '',
      tags: [...new Set([...(candidate?.tags ?? []), ...ordered.flatMap((skill) => skill.tags)])].sort(compareCanonicalText),
      icon: candidate?.icon ?? representative?.icon,
    }
    const release = buildAppRelease(registryID, shape, ordered.map(appReleaseSkill))
    return {
      revision: appRevision(release),
      app_id: shape.app_id,
      name: shape.name,
      description: shape.description,
      tags: shape.tags,
      ...(shape.icon ? { icon: shape.icon } : {}),
      ...appMetadataFields(shape),
      skills: ordered.map(compactCatalogSkill),
    }
  })
}

/** Category definitions referenced by a Snapshot's Apps, in display order. */
export function snapshotCategoriesFor(apps: SnapshotApp[], categories: CategoryTable): SnapshotCategory[] {
  const ids = [...new Set(apps.map((pkg) => pkg.category))]
  return ids.map((id) => categories.snapshotCategory(id))
    .sort((a, b) => a.order - b.order || compareCanonicalText(a.id, b.id))
}

function appReleaseSkill(skill: CatalogSkill): AppReleaseSkill {
  const { registry_priority: _priority, source: _source, ...member } = skill
  return member
}

export function appReleaseFromSnapshotApp(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotApp,
): AppRelease {
  return buildAppRelease(
    snapshot.registry_id,
    pkg,
    catalogSkillsFromSnapshotApp(snapshot, pkg).map(appReleaseSkill),
  )
}

export function catalogSkillsFromSnapshot(snapshot: SkillRegistrySnapshot): CatalogSkill[] {
  return snapshot.apps.flatMap((pkg) => catalogSkillsFromSnapshotApp(snapshot, pkg))
}

export function catalogSkillsFromSnapshotApp(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotApp,
): CatalogSkill[] {
  return pkg.skills.map((skill) => ({
    schema_version: '2',
    registry_id: snapshot.registry_id,
    registry_priority: snapshot.registry_priority,
    app_id: pkg.app_id,
    skill_id: skill.skill_id,
    install_id: skillInstallID(snapshot.registry_id, pkg.app_id, skill.skill_id),
    name: skill.name,
    description: skill.description,
    author: { name: skill.author.name, email: skill.author.email ?? '' },
    homepage: skill.homepage,
    tags: skill.tags,
    category: skill.category,
    category_name: skill.category_name,
    source_category: skill.source_category,
    source: {
      type: snapshot.source.type,
      revision: snapshot.source.revision,
      path: skill.source_path,
      repository: snapshot.source.repository,
    },
    files: skill.files,
    icon: skill.icon,
    artifact: {
      format: 'memoh_skill_v1',
      digest: skill.artifact.digest,
      size: skill.artifact.size,
      uncompressed_size: skill.artifact.uncompressed_size,
      archive_size: skill.artifact.archive_size,
      file_count: skill.artifact.file_count,
      content_type: 'application/gzip',
    },
  }))
}
