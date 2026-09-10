import type {
  PackageConnectorReference,
  PackagePostinstallCommand,
  PackageTranslations,
  RegistryDiagnostic,
  SkillAuthor,
  SkillIcon,
  SkillImageAsset,
  SkillRegistryDefinition,
} from '../types'
import type { SkillSourceFile } from '../filesystem'
import type { RegistryBuildBudget } from '../budget'

export interface SkillCandidate {
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
  source_path: string
  files: Record<string, SkillSourceFile>
  icon?: SkillIcon
  icon_assets?: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }>
}

/**
 * Package-level metadata read by an adapter. Reviewed Memoh Packages carry
 * their `package.yaml`; imported registries usually leave the Package to be
 * synthesized from its Skills and only record what the source declares.
 */
export interface PackageCandidate {
  package_id: string
  /** True when the metadata comes from a reviewed `package.yaml`. */
  reviewed: boolean
  version?: string
  name?: string
  description?: string
  author?: SkillAuthor
  homepage?: string
  repository?: string
  license?: string
  /** Category ID for reviewed Packages, or the source's free-text category. */
  category?: string
  tags: string[]
  translations?: PackageTranslations
  dependencies: string[]
  connectors: PackageConnectorReference[]
  postinstall?: PackagePostinstallCommand[]
  icon?: SkillIcon
  icon_assets?: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }>
}

export interface SkillAdapterResult {
  skills: SkillCandidate[]
  diagnostics: RegistryDiagnostic[]
  packages: Map<string, PackageCandidate>
}

export interface SkillAdapterInput {
  definition: SkillRegistryDefinition
  sourceRoot: string
  ensurePaths: (paths: string[]) => Promise<void>
  budget: RegistryBuildBudget
}
