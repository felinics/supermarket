import type { SkillRegistryDefinition } from '../types'

export interface MaterializedSkillRegistrySource {
  root: string
  revision: string
  definition: SkillRegistryDefinition
  ensurePaths(paths: string[]): Promise<void>
  cleanup(): Promise<void>
}
