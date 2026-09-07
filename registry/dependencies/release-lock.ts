import path from 'node:path'
import { loadDigestLock, writeDigestLock } from '#lib/release-lock'
import { buildDependencyCandidate } from './build'

const lockPath = (root: string) => path.join(root, 'registries/memoh/dependencies.lock.json')

export async function lockDependencies(root: string) {
  const candidate = await buildDependencyCandidate(root)
  await writeDigestLock(lockPath(root), 'snapshot_revision', 'Dependency release lock', { snapshot_revision: candidate.revision })
  return candidate
}

export async function approvedDependencies(root: string) {
  const [candidate, lock] = await Promise.all([
    buildDependencyCandidate(root), loadDigestLock(lockPath(root), 'snapshot_revision', 'Dependency release lock'),
  ])
  if (candidate.revision !== lock.snapshot_revision) throw new Error('Dependency snapshot does not match dependencies.lock.json; review and regenerate the lock')
  return candidate
}
