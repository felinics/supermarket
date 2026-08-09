import type { SkillRegistryDefinition } from '../types'
import { readCodexMarketplace } from './codex-marketplace'
import { readMemohRegistry } from './memoh'
import { readSkillDirectory } from './skill-directory'
import { RegistryBuildBudget } from '../budget'

export function skillAdapterBootstrapPaths(definition: SkillRegistryDefinition): string[] {
  if (definition.adapter.type === 'codex_marketplace_skills') return [definition.adapter.catalog_path]
  return []
}

export function buildSkillCandidates(input: {
  definition: SkillRegistryDefinition
  sourceRoot: string
  ensurePaths?: (paths: string[]) => Promise<void>
  budget?: RegistryBuildBudget
}) {
  const { definition, sourceRoot, ensurePaths = async () => {}, budget = new RegistryBuildBudget() } = input
  const adapterInput = { definition, sourceRoot, ensurePaths, budget }
  if (definition.adapter.type === 'skill_directory') return readSkillDirectory(adapterInput)
  if (definition.adapter.type === 'memoh') return readMemohRegistry(adapterInput)
  if (definition.adapter.type === 'codex_marketplace_skills') return readCodexMarketplace(adapterInput)
  throw new Error(`${definition.id}: unsupported adapter`)
}
