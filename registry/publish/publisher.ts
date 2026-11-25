import type { SkillIcon, SkillRegistryDefinition, SkillRegistrySnapshot } from '../types'
import type { SkillRegistryStore } from '../storage/contracts'
import { assertReleaseCandidate, type RegistryReleaseLock } from './release-lock'
import {
  buildSkillRegistryCandidate,
  type SkillRegistryCandidate,
  type SkillRegistryBuildProgress,
} from './candidate'
import { appReleaseFromSnapshotApp } from '../snapshot'

export interface SkillRegistryPublishResult {
  registry: string
  revision?: string
  skills?: number
  apps?: number
  diagnostics?: number
  skipped?: 'disabled' | 'unchanged'
}

export type SkillRegistryPublishProgress =
  | SkillRegistryBuildProgress
  | { type: 'skill'; registry: string; index: number; total: number; app_id: string; skill_id: string; uploaded: boolean }
  | { type: 'app'; registry: string; app_id: string; uploaded: boolean }
  | { type: 'publishing'; registry: string; revision: string }

function sameDefinition(left: SkillRegistryDefinition, right: SkillRegistryDefinition) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function requireReleaseLock(
  definition: SkillRegistryDefinition,
  lock: RegistryReleaseLock | undefined,
) {
  if (!lock) throw new Error(`${definition.id}: release.lock.json is required`)
  return lock
}

function iconAssets(icon?: SkillIcon) {
  return [icon?.card, icon?.detail, icon?.dark]
}

/**
 * Digest-addressed objects referenced by a previously published Snapshot.
 * Objects are immutable and never deleted, so a digest listed there is
 * already stored and can skip its existence-check upload.
 */
function collectSnapshotDigests(snapshot: SkillRegistrySnapshot) {
  const digests = new Set<string>()
  for (const pkg of snapshot.apps) {
    for (const descriptor of iconAssets(pkg.icon)) {
      if (descriptor) digests.add(descriptor.digest)
    }
    for (const skill of pkg.skills) {
      digests.add(skill.artifact.digest)
      for (const descriptor of iconAssets(skill.icon)) {
        if (descriptor) digests.add(descriptor.digest)
      }
    }
  }
  return digests
}

/** Previously published App revisions, keyed by App ID. */
function collectSnapshotAppRevisions(snapshot: SkillRegistrySnapshot) {
  return new Map(snapshot.apps.map((pkg) => [pkg.app_id, pkg.revision]))
}

export class SkillRegistryPublisher {
  constructor(
    private readonly store: SkillRegistryStore,
    private readonly projectRoot: string,
    private readonly onProgress: (progress: SkillRegistryPublishProgress) => void = () => {},
  ) {}

  private async publishCandidateAssets(
    candidate: SkillRegistryCandidate,
    knownDigests: ReadonlySet<string>,
  ) {
    const uploadedArtifacts = new Map<string, boolean>()
    const uploadedImages = new Map<string, boolean>()
    const uploadImage = async (digest: string, label: string) => {
      const known = uploadedImages.get(digest)
      if (known != null) return known
      if (knownDigests.has(digest)) {
        uploadedImages.set(digest, false)
        return false
      }
      const image = candidate.images.get(digest)
      if (!image) throw new Error(`Candidate ${label} icon is missing: ${digest}`)
      const stored = (await this.store.putImage(image.descriptor, image.bytes)).stored
      uploadedImages.set(digest, stored)
      return stored
    }
    for (const [index, skill] of candidate.skills.entries()) {
      let uploaded = uploadedArtifacts.get(skill.artifact.digest)
      if (uploaded == null) {
        if (knownDigests.has(skill.artifact.digest)) {
          uploaded = false
        } else {
          const artifact = candidate.artifacts.get(skill.artifact.digest)
          if (!artifact) throw new Error(`Candidate Artifact is missing: ${skill.artifact.digest}`)
          uploaded = (await this.store.putArtifact(artifact.descriptor, artifact.bytes)).stored
        }
        uploadedArtifacts.set(skill.artifact.digest, uploaded)
      }
      for (const descriptor of iconAssets(skill.icon)) {
        if (!descriptor) continue
        uploaded ||= await uploadImage(descriptor.digest, 'Skill')
      }
      this.onProgress({
        type: 'skill',
        registry: candidate.definition.id,
        index: index + 1,
        total: candidate.skills.length,
        app_id: skill.app_id,
        skill_id: skill.skill_id,
        uploaded,
      })
    }
    for (const pkg of candidate.snapshot.apps) {
      let uploaded = false
      for (const descriptor of iconAssets(pkg.icon)) {
        if (!descriptor) continue
        uploaded ||= await uploadImage(descriptor.digest, 'App')
      }
      this.onProgress({ type: 'app', registry: candidate.definition.id, app_id: pkg.app_id, uploaded })
    }
  }

  /**
   * Loads the previously published Snapshot so publication can skip objects
   * that are already stored. Objects are immutable and the Snapshot pointer
   * switches only after a complete publication, so every object referenced by
   * the current state is still present. Any read failure falls back to a
   * full upload instead of blocking publication.
   *
   * The skip assumes the store never deletes objects. Restoring the bucket
   * from a partial backup (snapshots present but app releases or artifacts
   * missing) would leave the skipped objects unwritten and publish a Snapshot
   * that references missing objects. Object retention is a hard operational
   * invariant of the store; a full re-upload is the recovery for a broken
   * bucket.
   */
  private async loadPreviousSnapshot(registryID: string, revision?: string | null) {
    if (!revision) return null
    try {
      return await this.store.getSnapshot(registryID, revision)
    } catch {
      return null
    }
  }

  async publish(
    definition: SkillRegistryDefinition,
    releaseLock?: RegistryReleaseLock,
    prebuiltCandidate?: SkillRegistryCandidate,
  ): Promise<SkillRegistryPublishResult> {
    const stateRead = await this.store.getStateWithVersion(definition.id)
    const previousState = stateRead.state
    const stateVersion = stateRead.versioning === 'conditional'
      ? stateRead.version
      : undefined
    if (!definition.enabled) {
      await this.store.putState({
        schema_version: '2',
        definition,
        current_snapshot: previousState?.current_snapshot,
        current_summary: previousState?.current_summary,
      }, stateVersion)
      return { registry: definition.id, skipped: 'disabled' }
    }

    const lock = requireReleaseLock(definition, releaseLock)
    if (prebuiltCandidate && !sameDefinition(prebuiltCandidate.definition, definition)) {
      throw new Error(`${definition.id}: prebuilt candidate uses a different Registry definition`)
    }
    const candidate = prebuiltCandidate ?? await buildSkillRegistryCandidate(
      definition,
      this.projectRoot,
      { onProgress: this.onProgress },
    )
    assertReleaseCandidate(definition, lock, candidate.revision)
    if (previousState?.current_snapshot === candidate.revision) {
      if (!sameDefinition(previousState.definition, definition)) {
        await this.store.putState({
          ...previousState,
          schema_version: '2',
          definition,
        }, stateVersion)
      }
      return {
        registry: definition.id,
        revision: candidate.revision,
        skills: candidate.skills.length,
        apps: candidate.snapshot.apps.length,
        diagnostics: candidate.diagnostics.length,
        skipped: 'unchanged',
      }
    }

    const previousSnapshot = await this.loadPreviousSnapshot(definition.id, previousState?.current_snapshot)
    const knownDigests = previousSnapshot ? collectSnapshotDigests(previousSnapshot) : new Set<string>()
    const knownAppRevisions = previousSnapshot ? collectSnapshotAppRevisions(previousSnapshot) : new Map<string, string>()

    await this.publishCandidateAssets(candidate, knownDigests)
    for (const pkg of candidate.snapshot.apps) {
      if (knownAppRevisions.get(pkg.app_id) === pkg.revision) continue
      const stored = await this.store.putAppRelease(
        appReleaseFromSnapshotApp(candidate.snapshot, pkg),
      )
      if (stored.revision !== pkg.revision) {
        throw new Error(`${definition.id}/${pkg.app_id}: App revision does not match its Snapshot`)
      }
    }
    this.onProgress({ type: 'publishing', registry: definition.id, revision: candidate.revision })
    await this.store.publishSnapshot(candidate.snapshotBytes, definition, { expectedVersion: stateVersion })
    return {
      registry: definition.id,
      revision: candidate.revision,
      skills: candidate.skills.length,
      apps: candidate.snapshot.apps.length,
      diagnostics: candidate.diagnostics.length,
    }
  }
}
