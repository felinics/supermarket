import { createHash } from 'node:crypto'
import { skillInstallID } from './definition'
import type {
  CatalogSkill,
  SkillIcon,
  SkillPackageRelease,
  SkillPackageReleaseSkill,
  SkillPackageMetadata,
  SnapshotCategory,
  SnapshotPackage,
  SkillRegistrySnapshot,
  SnapshotSkill,
} from './types'
import type { PackageCandidate } from './adapters/types'
import { CategoryTable, defaultCategoryTable } from './categories'
import { compareCanonicalText } from '#lib/order'

const encoder = new TextEncoder()

export function serializeRegistrySnapshot(snapshot: SkillRegistrySnapshot): Uint8Array {
  return encoder.encode(`${JSON.stringify(snapshot, null, 2)}\n`)
}

export function registrySnapshotRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function serializeSkillPackageRelease(release: SkillPackageRelease): Uint8Array {
  return encoder.encode(`${JSON.stringify(release, null, 2)}\n`)
}

export function skillPackageRevision(release: SkillPackageRelease): string {
  return registrySnapshotRevision(serializeSkillPackageRelease(release))
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

function copyPostinstall(metadata?: Pick<SkillPackageMetadata, 'postinstall'>) {
  return metadata?.postinstall?.map(({ command, args }) => ({ command, args: [...args] }))
}

function copyTranslations(translations: NonNullable<SkillPackageMetadata['translations']>) {
  const copy: NonNullable<SkillPackageMetadata['translations']> = {}
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
 * Copies Package metadata in a fixed key order so Snapshot entries and
 * immutable releases serialize identically.
 */
export function packageMetadataFields(source: SkillPackageMetadata): SkillPackageMetadata {
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

type PackageShape = SkillPackageMetadata & {
  package_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
}

function buildPackageRelease(
  registryID: string,
  pkg: PackageShape,
  skills: SkillPackageReleaseSkill[],
): SkillPackageRelease {
  return {
    schema_version: '1',
    registry_id: registryID,
    package_id: pkg.package_id,
    name: pkg.name,
    description: pkg.description,
    tags: [...pkg.tags],
    ...(pkg.icon ? { icon: pkg.icon } : {}),
    ...packageMetadataFields(pkg),
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

export interface CompactPackagesOptions {
  /** Required when a Package has no Skills, otherwise inferred from them. */
  registry?: string
  packages?: ReadonlyMap<string, PackageCandidate>
  categories?: CategoryTable
}

export function compactCatalogPackages(
  skills: CatalogSkill[],
  options: CompactPackagesOptions = {},
): SnapshotPackage[] {
  const packages = options.packages ?? new Map<string, PackageCandidate>()
  const categories = options.categories ?? defaultCategoryTable()
  const groups = new Map<string, CatalogSkill[]>()
  for (const skill of skills) {
    const group = groups.get(skill.package_id) ?? []
    group.push(skill)
    groups.set(skill.package_id, group)
  }
  const packageIDs = [...new Set([...groups.keys(), ...packages.keys()])].sort(compareCanonicalText)
  const registryID = options.registry ?? skills[0]?.registry_id
  return packageIDs.map((packageID) => {
    if (!registryID) throw new Error(`Package ${packageID}: registry ID is required`)
    const candidate = packages.get(packageID)
    const ordered = [...(groups.get(packageID) ?? [])].sort((a, b) => compareCanonicalText(a.skill_id, b.skill_id))
    const representative = ordered.find((skill) => skill.skill_id === packageID) ?? ordered[0]
    const category = candidate?.reviewed && candidate.category
      ? categories.require(candidate.category, `${registryID}/${packageID}`)
      : categories.resolve(candidate?.category ?? dominantCategory(ordered))
    const metadata: SkillPackageMetadata = {
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
    const shape: PackageShape = {
      ...packageMetadataFields(metadata),
      package_id: packageID,
      name: candidate?.name ?? packageID,
      description: candidate?.description ?? representative?.description ?? '',
      tags: [...new Set([...(candidate?.tags ?? []), ...ordered.flatMap((skill) => skill.tags)])].sort(compareCanonicalText),
      icon: candidate?.icon ?? representative?.icon,
    }
    const release = buildPackageRelease(registryID, shape, ordered.map(packageReleaseSkill))
    return {
      revision: skillPackageRevision(release),
      package_id: shape.package_id,
      name: shape.name,
      description: shape.description,
      tags: shape.tags,
      ...(shape.icon ? { icon: shape.icon } : {}),
      ...packageMetadataFields(shape),
      skills: ordered.map(compactCatalogSkill),
    }
  })
}

/** Category definitions referenced by a Snapshot's Packages, in display order. */
export function snapshotCategoriesFor(packages: SnapshotPackage[], categories: CategoryTable): SnapshotCategory[] {
  const ids = [...new Set(packages.map((pkg) => pkg.category))]
  return ids.map((id) => categories.snapshotCategory(id))
    .sort((a, b) => a.order - b.order || compareCanonicalText(a.id, b.id))
}

function packageReleaseSkill(skill: CatalogSkill): SkillPackageReleaseSkill {
  const { registry_priority: _priority, source: _source, ...member } = skill
  return member
}

export function skillPackageReleaseFromSnapshotPackage(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotPackage,
): SkillPackageRelease {
  return buildPackageRelease(
    snapshot.registry_id,
    pkg,
    catalogSkillsFromSnapshotPackage(snapshot, pkg).map(packageReleaseSkill),
  )
}

export function catalogSkillsFromSnapshot(snapshot: SkillRegistrySnapshot): CatalogSkill[] {
  return snapshot.packages.flatMap((pkg) => catalogSkillsFromSnapshotPackage(snapshot, pkg))
}

export function catalogSkillsFromSnapshotPackage(
  snapshot: SkillRegistrySnapshot,
  pkg: SnapshotPackage,
): CatalogSkill[] {
  return pkg.skills.map((skill) => ({
    schema_version: '1',
    registry_id: snapshot.registry_id,
    registry_priority: snapshot.registry_priority,
    package_id: pkg.package_id,
    skill_id: skill.skill_id,
    install_id: skillInstallID(snapshot.registry_id, pkg.package_id, skill.skill_id),
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
