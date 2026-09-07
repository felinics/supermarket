// Cross-language protocol fixtures for the Memoh consumer. These are test
// data only; Memoh never embeds the official catalog into its server binary.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { approvedDependencies } from '#registry/dependencies/release-lock'
import { dependencyJSON } from '#registry/dependencies/types'

const index = process.argv.indexOf('--destination')
const destination = index >= 0 ? process.argv[index + 1] : undefined
if (!destination) throw new Error('--destination is required')
const candidate = await approvedDependencies(path.resolve(import.meta.dirname, '../..'))
await mkdir(destination, { recursive: true })
await writeFile(path.join(destination, 'index.json'), dependencyJSON({
  total: candidate.releases.length, page: 1, limit: 256, revision: candidate.revision, data: candidate.snapshot.dependencies,
}))
for (const descriptor of candidate.snapshot.dependencies) {
  const { revision: _revision, ...release } = descriptor
  const directory = path.join(destination, descriptor.dependency_id)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'release.json'), dependencyJSON(release))
  await writeFile(path.join(directory, 'artifact.tar.gz'), candidate.artifacts.get(descriptor.artifact.digest)!)
}
console.log(`Exported ${candidate.releases.length} Dependency fixtures at ${candidate.revision}`)
