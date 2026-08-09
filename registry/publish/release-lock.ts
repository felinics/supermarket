import path from 'node:path'
import { assertRegistryID } from '../definition'
import type { SkillRegistryDefinition } from '../types'
import {
  loadDigestLock,
  parseDigestLock,
  serializeDigestLock,
  writeDigestLock,
} from '#lib/release-lock'

export interface RegistryReleaseLock {
  snapshot_revision: string
}

export function releaseLockPath(projectRoot: string, registryID: string) {
  return path.join(
    projectRoot,
    'registries',
    assertRegistryID(registryID, 'registry ID'),
    'release.lock.json',
  )
}

export function serializeRegistryReleaseLock(lock: RegistryReleaseLock): Uint8Array {
  return serializeDigestLock(lock)
}

export function parseRegistryReleaseLock(
  bytes: Uint8Array,
  definition: SkillRegistryDefinition,
): RegistryReleaseLock {
  return parseDigestLock(bytes, 'snapshot_revision', `${definition.id}: release.lock.json`)
}

export async function loadRegistryReleaseLock(
  projectRoot: string,
  definition: SkillRegistryDefinition,
): Promise<RegistryReleaseLock> {
  return loadDigestLock(
    releaseLockPath(projectRoot, definition.id),
    'snapshot_revision',
    `${definition.id}: release.lock.json`,
  )
}

export async function writeRegistryReleaseLock(
  projectRoot: string,
  definition: SkillRegistryDefinition,
  lock: RegistryReleaseLock,
) {
  await writeDigestLock(
    releaseLockPath(projectRoot, definition.id),
    'snapshot_revision',
    `${definition.id}: release.lock.json`,
    lock,
  )
}

export function assertReleaseCandidate(
  definition: SkillRegistryDefinition,
  lock: RegistryReleaseLock,
  revision: string,
) {
  if (lock.snapshot_revision !== revision) {
    throw new Error(
      `${definition.id}: release.lock.json locks Snapshot ${lock.snapshot_revision}, `
      + `but the rebuilt Snapshot is ${revision}`,
    )
  }
}
