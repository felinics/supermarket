import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseSkillRegistryDefinition } from '../definition'
import type { SkillRegistryDefinition } from '../types'

export interface SkillRegistryDefinitionFailure {
  registry: string
  path: string
  error: unknown
}

export async function loadSkillRegistryDefinitionResults(projectRoot: string) {
  const root = path.join(projectRoot, 'registries')
  const definitions: SkillRegistryDefinition[] = []
  const failures: SkillRegistryDefinitionFailure[] = []
  const ids = new Set<string>()
  for await (const relativePath of new Bun.Glob('*/registry.yaml').scan({ cwd: root })) {
    try {
      const definition = parseSkillRegistryDefinition(parseYaml(await readFile(path.join(root, relativePath), 'utf8')))
      if (ids.has(definition.id)) throw new Error(`Duplicate registry ID: ${definition.id}`)
      if (path.dirname(relativePath) !== definition.id) throw new Error(`${relativePath}: directory must match Registry ID`)
      ids.add(definition.id)
      definitions.push(definition)
    } catch (error) {
      failures.push({ registry: path.dirname(relativePath), path: relativePath, error })
    }
  }
  definitions.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  failures.sort((a, b) => a.path.localeCompare(b.path))
  return { definitions, failures }
}

export async function loadSkillRegistryDefinitions(projectRoot: string) {
  const result = await loadSkillRegistryDefinitionResults(projectRoot)
  if (result.failures.length) {
    throw new AggregateError(
      result.failures.map((failure) => failure.error),
      result.failures.map((failure) => `${failure.path}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`).join('\n'),
    )
  }
  return result.definitions
}
