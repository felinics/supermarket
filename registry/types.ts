import { MAX_TAR_UNCOMPRESSED_BYTES } from '#lib/archive'

export interface SkillAuthor {
  name: string
  email: string
}

export const MAX_SKILL_ARTIFACT_COMPRESSED_BYTES = 6 * 1024 * 1024
export const MAX_SKILL_ARTIFACT_UNCOMPRESSED_BYTES = MAX_TAR_UNCOMPRESSED_BYTES
export const MAX_SKILL_ARTIFACT_ARCHIVE_BYTES = MAX_TAR_UNCOMPRESSED_BYTES
export const MAX_SKILL_ARTIFACT_FILES = 1_000
export const MAX_SKILL_IMAGE_BYTES = 512 * 1024

export type SkillRegistryAdapter =
  | { type: 'skill_directory' }
  | { type: 'memoh' }
  | { type: 'codex_marketplace_skills'; catalog_path: string }

export type SkillRegistrySource =
  | { type: 'local'; path: string }
  | {
    type: 'git'
    url: string
    revision: string
    tracking_ref?: string
    path?: string
  }

export interface SkillRegistryDefinition {
  schema_version: '1'
  id: string
  name: string
  enabled: boolean
  priority: number
  adapter: SkillRegistryAdapter
  source: SkillRegistrySource
}

export interface SkillArtifactDescriptor {
  format: 'memoh_skill_v1'
  digest: string
  size: number
  /** Aggregate bytes of regular file bodies, excluding tar framing. */
  uncompressed_size: number
  /** Complete serialized tar bytes after gzip decompression. */
  archive_size: number
  /** Number of regular files in the tar archive. */
  file_count: number
  content_type: 'application/gzip'
}

export type SkillArtifactBlob = Pick<
  SkillArtifactDescriptor,
  'format' | 'digest' | 'size' | 'content_type'
>

export type SkillImageContentType = 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp'

export interface SkillImageAsset {
  digest: string
  size: number
  content_type: SkillImageContentType
}

export interface SkillIcon {
  card?: SkillImageAsset
  detail?: SkillImageAsset
  dark?: SkillImageAsset
  brand_color?: string
}

export interface PackagePostinstallCommand {
  command: string
  args: string[]
}

export interface SkillPackageMetadata {
  postinstall?: PackagePostinstallCommand[]
}

export interface CatalogSkill {
  schema_version: '1'
  registry_id: string
  registry_priority: number
  package_id: string
  skill_id: string
  install_id: string
  name: string
  description: string
  author: SkillAuthor
  homepage?: string
  tags: string[]
  category: string
  category_name: string
  source_category?: string
  source: {
    type: SkillRegistrySource['type']
    revision: string
    path: string
    repository?: string
  }
  files: string[]
  icon?: SkillIcon
  artifact: SkillArtifactDescriptor
}

/**
 * The compact, immutable representation stored in a Registry Snapshot.
 * Registry and source fields that every Skill shares live on the Snapshot
 * itself; API readers hydrate this back into CatalogSkill at their boundary.
 */
export interface SnapshotSkill {
  skill_id: string
  name: string
  description: string
  author: { name: string; email?: string }
  homepage?: string
  tags: string[]
  category: string
  category_name: string
  source_category?: string
  source_path: string
  files: string[]
  icon?: SkillIcon
  artifact: Pick<
    SkillArtifactDescriptor,
    'digest' | 'size' | 'uncompressed_size' | 'archive_size' | 'file_count'
  >
}

export interface SnapshotPackage extends SkillPackageMetadata {
  revision: string
  package_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
  skills: SnapshotSkill[]
}

export type SkillPackageReleaseSkill = Omit<CatalogSkill, 'registry_priority' | 'source'>

export interface SkillPackageRelease extends SkillPackageMetadata {
  schema_version: '1'
  registry_id: string
  package_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
  skills: SkillPackageReleaseSkill[]
}

export interface SnapshotSource {
  type: SkillRegistrySource['type']
  revision: string
  repository?: string
}

export interface RegistryDiagnostic {
  package_id?: string
  skill_id?: string
  code: 'no_skills' | 'package_invalid'
  message: string
}

export interface SkillRegistrySnapshot {
  schema_version: '1'
  registry_id: string
  registry_priority: number
  source: SnapshotSource
  packages: SnapshotPackage[]
  diagnostics: RegistryDiagnostic[]
}

/**
 * The only mutable object for one Registry. A state update switches the
 * complete reader-visible view together: its definition and active snapshot.
 */
export interface SkillRegistryState {
  schema_version: '1'
  definition: SkillRegistryDefinition
  current_snapshot?: string
  current_summary?: SkillRegistryCurrentSummary
}

/**
 * The compact, reader-facing projection of the active Snapshot. It lives in
 * state.json so Registry listings do not have to download every Snapshot.
 */
export interface SkillRegistryCurrentSummary {
  revision: string
  source_revision: string
  published_at: string
  skill_count: number
  package_count: number
  category_count: number
  skipped_package_count: number
}

export interface SkillRegistrySummary {
  id: string
  name: string
  enabled: boolean
  priority: number
  adapter: SkillRegistryAdapter['type']
  revision?: string
  published_at?: string
  skill_count: number
  package_count: number
  category_count: number
  skipped_package_count: number
}

export interface SkillCategorySummary {
  id: string
  name: string
  count: number
  registries: Array<{ id: string; count: number }>
}

export interface SkillPackageCategorySummary {
  id: string
  name: string
  skill_count: number
}

export interface SkillPackageSummary {
  schema_version: '1'
  registry_id: string
  registry_priority: number
  package_id: string
  name: string
  description: string
  tags: string[]
  categories: SkillPackageCategorySummary[]
  skill_count: number
  icon?: SkillIcon
}

export interface SkillPackageDescriptor extends SkillPackageRelease {
  revision: string
  categories: SkillPackageCategorySummary[]
  skill_count: number
}
