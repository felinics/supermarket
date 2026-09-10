import type { SkillIcon, SkillRegistryDefinition } from '../types'
import type { SkillRegistryStore } from '../storage/contracts'
import { assertReleaseCandidate, type RegistryReleaseLock } from './release-lock'
import {
  buildSkillRegistryCandidate,
  type SkillRegistryCandidate,
  type SkillRegistryBuildProgress,
} from './candidate'
import { skillPackageReleaseFromSnapshotPackage } from '../snapshot'

export interface SkillRegistryPublishResult {
  registry: string
  revision?: string
  skills?: number
  packages?: number
  diagnostics?: number
  skipped?: 'disabled' | 'unchanged'
}

export type SkillRegistryPublishProgress =
  | SkillRegistryBuildProgress
  | { type: 'skill'; registry: string; index: number; total: number; package_id: string; skill_id: string; uploaded: boolean }
  | { type: 'package'; registry: string; package_id: string; uploaded: boolean }
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

  private async publishCandidateAssets(candidate: SkillRegistryCandidate) {
    const uploadedArtifacts = new Map<string, boolean>()
    const uploadedImages = new Map<string, boolean>()
    const uploadImage = async (digest: string, label: string) => {
      const known = uploadedImages.get(digest)
      if (known != null) return known
      const image = candidate.images.get(digest)
      if (!image) throw new Error(`Candidate ${label} icon is missing: ${digest}`)
      const stored = (await this.store.putImage(image.descriptor, image.bytes)).stored
      uploadedImages.set(digest, stored)
      return stored
    }
    for (const [index, skill] of candidate.skills.entries()) {
      let uploaded = uploadedArtifacts.get(skill.artifact.digest)
      if (uploaded == null) {
        const artifact = candidate.artifacts.get(skill.artifact.digest)
        if (!artifact) throw new Error(`Candidate Artifact is missing: ${skill.artifact.digest}`)
        uploaded = (await this.store.putArtifact(artifact.descriptor, artifact.bytes)).stored
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
        package_id: skill.package_id,
        skill_id: skill.skill_id,
        uploaded,
      })
    }
    for (const pkg of candidate.snapshot.packages) {
      let uploaded = false
      for (const descriptor of iconAssets(pkg.icon)) {
        if (!descriptor) continue
        uploaded ||= await uploadImage(descriptor.digest, 'Package')
      }
      this.onProgress({ type: 'package', registry: candidate.definition.id, package_id: pkg.package_id, uploaded })
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
        schema_version: '1',
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
          schema_version: '1',
          definition,
        }, stateVersion)
      }
      return {
        registry: definition.id,
        revision: candidate.revision,
        skills: candidate.skills.length,
        packages: candidate.snapshot.packages.length,
        diagnostics: candidate.diagnostics.length,
        skipped: 'unchanged',
      }
    }

    await this.publishCandidateAssets(candidate)
    for (const pkg of candidate.snapshot.packages) {
      const stored = await this.store.putPackageRelease(
        skillPackageReleaseFromSnapshotPackage(candidate.snapshot, pkg),
      )
      if (stored.revision !== pkg.revision) {
        throw new Error(`${definition.id}/${pkg.package_id}: Package revision does not match its Snapshot`)
      }
    }
    this.onProgress({ type: 'publishing', registry: definition.id, revision: candidate.revision })
    await this.store.publishSnapshot(candidate.snapshotBytes, definition, { expectedVersion: stateVersion })
    return {
      registry: definition.id,
      revision: candidate.revision,
      skills: candidate.skills.length,
      packages: candidate.snapshot.packages.length,
      diagnostics: candidate.diagnostics.length,
    }
  }
}
