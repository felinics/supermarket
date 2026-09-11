import type {
  AppConnectorReference,
  AppPostinstallCommand,
  AppTranslations,
  RegistryDiagnostic,
  SkillAuthor,
  SkillIcon,
  SkillImageAsset,
  SkillRegistryDefinition,
} from '../types'
import type { SkillSourceFile } from '../filesystem'
import type { RegistryBuildBudget } from '../budget'

export interface SkillCandidate {
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
  source_path: string
  files: Record<string, SkillSourceFile>
  icon?: SkillIcon
  icon_assets?: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }>
}

/**
 * App-level metadata read by an adapter. Reviewed Memoh Apps carry
 * their `app.yaml`; imported registries usually leave the App to be
 * synthesized from its Skills and only record what the source declares.
 */
export interface AppCandidate {
  app_id: string
  /** True when the metadata comes from a reviewed `app.yaml`. */
  reviewed: boolean
  version?: string
  name?: string
  description?: string
  author?: SkillAuthor
  homepage?: string
  repository?: string
  license?: string
  /** Category ID for reviewed Apps, or the source's free-text category. */
  category?: string
  tags: string[]
  translations?: AppTranslations
  dependencies: string[]
  connectors: AppConnectorReference[]
  postinstall?: AppPostinstallCommand[]
  icon?: SkillIcon
  icon_assets?: Array<{ descriptor: SkillImageAsset; bytes: Uint8Array }>
}

export interface SkillAdapterResult {
  skills: SkillCandidate[]
  diagnostics: RegistryDiagnostic[]
  apps: Map<string, AppCandidate>
}

export interface SkillAdapterInput {
  definition: SkillRegistryDefinition
  sourceRoot: string
  ensurePaths: (paths: string[]) => Promise<void>
  budget: RegistryBuildBudget
}
