import type { SkillIcon, SkillRegistryDefinition } from '../types'
import type { SkillRegistryStore, StoredRegistryRefs } from '../storage/contracts'
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

export class SkillRegistryPublisher {
  constructor(
    private readonly store: SkillRegistryStore,
    private readonly projectRoot: string,
    private readonly onProgress: (progress: SkillRegistryPublishProgress) => void = () => {},
  ) {}

  private async publishCandidateAssets(
    candidate: SkillRegistryCandidate,
    knownArtifactDigests: ReadonlySet<string>,
    knownImageDigests: ReadonlySet<string>,
  ) {
    const uploadedArtifacts = new Map<string, boolean>()
    const uploadedImages = new Map<string, boolean>()
    const uploadImage = async (digest: string, label: string) => {
      const known = uploadedImages.get(digest)
      if (known != null) return known
      if (knownImageDigests.has(digest)) {
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
        if (knownArtifactDigests.has(skill.artifact.digest)) {
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
   * Lists the digest-addressed objects the store currently holds, so
   * publication uploads only what is missing. The listing — not a previously
   * published Snapshot — is the source of truth: objects lost after a partial
   * backup restore or accidental deletion are re-uploaded on the next
   * publication, even when the Snapshot content is unchanged. A listing
   * failure falls back to empty sets, i.e. a full upload, instead of blocking
   * publication; the failure is logged so a persistently misconfigured bucket
   * does not silently degrade every publish to a full re-upload.
   *
   * Skipping a listed object also skips the content verification that
   * putArtifact/putImage/putAppRelease run when they do write: stored bytes
   * are no longer re-hashed at publication time. Corruption at an existing
   * key is still detected, but at read time (getArtifact and getImage verify
   * content hashes), not before the Snapshot references the object.
   */
  private async loadStoredRefs(registryID: string): Promise<StoredRegistryRefs> {
    try {
      return await this.store.listStoredRefs(registryID)
    } catch (error) {
      console.warn(`${registryID}: listing stored objects failed; falling back to a full upload`, error)
      return { artifacts: new Set(), images: new Set(), appReleases: new Map() }
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

    const stored = await this.loadStoredRefs(definition.id)
    await this.publishCandidateAssets(candidate, stored.artifacts, stored.images)
    for (const pkg of candidate.snapshot.apps) {
      if (stored.appReleases.get(pkg.app_id)?.has(pkg.revision)) continue
      const storedRelease = await this.store.putAppRelease(
        appReleaseFromSnapshotApp(candidate.snapshot, pkg),
      )
      if (storedRelease.revision !== pkg.revision) {
        throw new Error(`${definition.id}/${pkg.app_id}: App revision does not match its Snapshot`)
      }
    }

    const unchanged = previousState?.current_snapshot === candidate.revision
    if (!unchanged) {
      this.onProgress({ type: 'publishing', registry: definition.id, revision: candidate.revision })
    }
    // Write the Snapshot and state pointer even when the content is
    // unchanged, so a no-op publication still repairs a lost Snapshot object,
    // state, or definition update instead of returning before any healing.
    await this.store.publishSnapshot(candidate.snapshotBytes, definition, { expectedVersion: stateVersion })
    return {
      registry: definition.id,
      revision: candidate.revision,
      skills: candidate.skills.length,
      apps: candidate.snapshot.apps.length,
      diagnostics: candidate.diagnostics.length,
      ...(unchanged ? { skipped: 'unchanged' as const } : {}),
    }
  }
}
