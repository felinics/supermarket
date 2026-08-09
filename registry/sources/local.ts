import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { SkillRegistryDefinition } from '../types'
import { resolveRealInside } from '../filesystem'
import { compareCanonicalText } from '#lib/order'
import type { MaterializedSkillRegistrySource } from './types'
import { MAX_REGISTRY_SOURCE_BYTES, MAX_REGISTRY_SOURCE_FILES } from '../budget'

async function directoryRevision(root: string) {
  const physicalRoot = await resolveRealInside(root)
  const hash = createHash('sha256')
  let fileCount = 0
  let totalBytes = 0
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => compareCanonicalText(a.name, b.name))
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const target = path.join(directory, entry.name)
      const stats = await lstat(target)
      if (stats.isSymbolicLink()) throw new Error(`Registry sources cannot contain symlinks: ${target}`)
      if (stats.isDirectory()) {
        await visit(target)
        continue
      }
      if (!stats.isFile()) continue
      fileCount++
      totalBytes += stats.size
      if (fileCount > MAX_REGISTRY_SOURCE_FILES || totalBytes > MAX_REGISTRY_SOURCE_BYTES) {
        throw new Error('Registry source exceeds revision hashing limits')
      }
      hash.update(path.relative(physicalRoot, target).replaceAll(path.sep, '/'))
      hash.update(`\0${stats.mode & 0o777}\0${stats.size}\0`)
      for await (const chunk of createReadStream(target)) hash.update(chunk)
      hash.update('\0')
    }
  }
  await visit(physicalRoot)
  return hash.digest('hex')
}

export async function materializeLocalSource(
  definition: SkillRegistryDefinition,
  projectRoot: string,
): Promise<MaterializedSkillRegistrySource> {
  if (definition.source.type !== 'local') throw new Error('Expected a local Registry source')
  const registryRoot = await resolveRealInside(projectRoot, path.join('registries', definition.id))
  const root = await resolveRealInside(registryRoot, definition.source.path)
  return {
    root,
    revision: await directoryRevision(root),
    definition,
    ensurePaths: async () => {},
    cleanup: async () => {},
  }
}
