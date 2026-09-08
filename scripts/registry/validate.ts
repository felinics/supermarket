import path from 'node:path'
import { loadSkillRegistryDefinitions } from '#registry/definitions/repository'
import { buildSkillRegistryCandidate } from '#registry/publish/candidate'
import { assertReleaseCandidate, loadRegistryReleaseLock } from '#registry/publish/release-lock'
import { approvedDependencies } from '#registry/dependencies/release-lock'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const kindIndex = process.argv.indexOf('--kind')
const kind = kindIndex >= 0 ? process.argv[kindIndex + 1] : 'all'
if (!kind || !['all', 'skills', 'dependencies'].includes(kind)) throw new Error('--kind must be all, skills, or dependencies')
const definitions = await loadSkillRegistryDefinitions(projectRoot)
for (const definition of definitions.filter((item) => kind !== 'dependencies' && item.enabled)) {
  const lock = await loadRegistryReleaseLock(projectRoot, definition)
  const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
  assertReleaseCandidate(definition, lock, candidate.revision)
}
if (kind !== 'dependencies') console.log(`Validated ${definitions.length} Skill Registries: ${definitions.map((definition) => definition.id).join(', ')}`)
if (kind !== 'skills') {
  const candidate = await approvedDependencies(projectRoot)
  console.log(`Validated ${candidate.releases.length} official Dependencies: ${candidate.revision}`)
}
