import path from 'node:path'
import { loadSkillRegistryDefinitions } from '#registry/definitions/repository'
import { writeRegistryReleaseLock } from '#registry/publish/release-lock'
import { buildSkillRegistryCandidate } from '#registry/publish/candidate'

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const projectRoot = path.resolve(import.meta.dirname, '../..')
const selectedRegistry = option('--registry')
const definitions = await loadSkillRegistryDefinitions(projectRoot)

if (selectedRegistry && !definitions.some((definition) => definition.id === selectedRegistry)) {
  throw new Error(`Registry not found: ${selectedRegistry}`)
}

for (const definition of definitions.filter(
  (item) => item.enabled && (!selectedRegistry || item.id === selectedRegistry),
)) {
  const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
  await writeRegistryReleaseLock(projectRoot, candidate.definition, {
    snapshot_revision: candidate.revision,
  })
  console.log(`${candidate.definition.id}: wrote Registry release.lock.json ${candidate.revision}`)
}
