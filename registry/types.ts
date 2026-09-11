import { MAX_TAR_UNCOMPRESSED_BYTES } from '#lib/archive'
import type { CategoryNames, AppLocale, SnapshotCategory } from './categories'

export type { CategoryNames, AppLocale, SnapshotCategory }

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

export interface AppPostinstallCommand {
  command: string
  args: string[]
}

export interface AppTranslation {
  name?: string
  description?: string
}

export type AppTranslations = Partial<Record<AppLocale, AppTranslation>>

/** A App's reference to a Connect-It connector type. */
export interface AppConnectorReference {
  type: string
  required: boolean
}

/** Parsed `app.yaml` (schema 2) of a reviewed Memoh App. */
export interface AppManifest {
  schema_version: '2'
  id: string
  version: string
  name: string
  description: string
  author?: SkillAuthor
  homepage?: string
  repository?: string
  license?: string
  /** Relative icon path inside the App directory. */
  icon?: string
  category: string
  tags: string[]
  translations?: AppTranslations
  /** Workspace dependency IDs the App references; the definitions stay in the dependency registry. */
  dependencies: string[]
  connectors: AppConnectorReference[]
  postinstall?: AppPostinstallCommand[]
}

/**
 * App-level metadata shared by Snapshot entries and immutable releases.
 * Imported registries synthesize it from their Skills; the Memoh registry
 * takes it from `app.yaml`.
 */
export interface AppMetadata {
  version?: string
  author?: SkillAuthor
  homepage?: string
  repository?: string
  license?: string
  category: string
  category_name: string
  translations?: AppTranslations
  dependencies: string[]
  connectors: AppConnectorReference[]
  postinstall?: AppPostinstallCommand[]
}

export interface CatalogSkill {
  schema_version: '2'
  registry_id: string
  registry_priority: number
  app_id: string
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

export interface SnapshotApp extends AppMetadata {
  revision: string
  app_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
  skills: SnapshotSkill[]
}

export type AppReleaseSkill = Omit<CatalogSkill, 'registry_priority' | 'source'>

export interface AppRelease extends AppMetadata {
  schema_version: '2'
  registry_id: string
  app_id: string
  name: string
  description: string
  tags: string[]
  icon?: SkillIcon
  skills: AppReleaseSkill[]
}

export interface SnapshotSource {
  type: SkillRegistrySource['type']
  revision: string
  repository?: string
}

export interface RegistryDiagnostic {
  app_id?: string
  skill_id?: string
  code: 'no_skills' | 'app_invalid'
  message: string
}

export interface SkillRegistrySnapshot {
  schema_version: '2'
  registry_id: string
  registry_priority: number
  source: SnapshotSource
  /** Category definitions used by this Snapshot's Apps, with localized names. */
  categories: SnapshotCategory[]
  apps: SnapshotApp[]
  diagnostics: RegistryDiagnostic[]
}

/**
 * The only mutable object for one Registry. A state update switches the
 * complete reader-visible view together: its definition and active snapshot.
 */
export interface SkillRegistryState {
  schema_version: '2'
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
  app_count: number
  category_count: number
  skipped_app_count: number
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
  app_count: number
  category_count: number
  skipped_app_count: number
}

export interface SkillCategorySummary {
  id: string
  name: string
  count: number
  registries: Array<{ id: string; count: number }>
}

/** App-level category listing with localized names and per-registry App counts. */
export interface AppCategorySummary {
  id: string
  name: string
  names: CategoryNames
  order: number
  app_count: number
  registries: Array<{ id: string; count: number }>
}

export interface AppSkillCategorySummary {
  id: string
  name: string
  skill_count: number
}

export type AppComponent = 'skills' | 'dependencies' | 'connectors'

export interface AppSummary extends AppMetadata {
  schema_version: '2'
  registry_id: string
  registry_priority: number
  app_id: string
  name: string
  description: string
  tags: string[]
  /** Skill-level categories present in the App. */
  categories: AppSkillCategorySummary[]
  skill_count: number
  dependency_count: number
  connector_count: number
  icon?: SkillIcon
}

export interface AppDescriptor extends AppRelease {
  revision: string
  categories: AppSkillCategorySummary[]
  skill_count: number
  dependency_count: number
  connector_count: number
}
