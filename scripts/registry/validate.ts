import path from 'node:path'
import { loadSkillRegistryDefinitions } from '#registry/definitions/repository'
import { buildSkillRegistryCandidate } from '#registry/publish/candidate'
import { assertReleaseCandidate, loadRegistryReleaseLock } from '#registry/publish/release-lock'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const definitions = await loadSkillRegistryDefinitions(projectRoot)
for (const definition of definitions.filter((item) => item.enabled)) {
  const lock = await loadRegistryReleaseLock(projectRoot, definition)
  const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
  assertReleaseCandidate(definition, lock, candidate.revision)
}
console.log(`Validated ${definitions.length} Skill Registries: ${definitions.map((definition) => definition.id).join(', ')}`)
