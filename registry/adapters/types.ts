import type {
  RegistryDiagnostic,
  SkillAuthor,
  SkillIcon,
  SkillImageAsset,
  SkillPackageMetadata,
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

export interface SkillAdapterResult {
  skills: SkillCandidate[]
  diagnostics: RegistryDiagnostic[]
  packageMetadata: Map<string, SkillPackageMetadata>
}

export interface SkillAdapterInput {
  definition: SkillRegistryDefinition
  sourceRoot: string
  ensurePaths: (paths: string[]) => Promise<void>
  budget: RegistryBuildBudget
}
