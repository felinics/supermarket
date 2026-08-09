import type {
  SkillArtifactBlob,
  SkillArtifactDescriptor,
  SkillImageAsset,
  SkillRegistrySnapshot,
  SkillRegistryState,
  SkillPackageRelease,
} from '../types'
import * as z from 'zod/mini'
import { MAX_SKILL_ARTIFACT_COMPRESSED_BYTES } from '../types'
import { assertRegistryComponentID, assertRegistryID } from '../definition'
import { summarizeCurrentSnapshot } from '../catalog'
import { sha256 } from '#lib/digest'
import {
  registrySnapshotRevision,
  sameBytes,
  serializeRegistrySnapshot,
  serializeSkillPackageRelease,
  skillPackageRevision,
} from '../snapshot'
import {
  type BlobBackend,
  type SkillRegistryStateRead,
  type SkillRegistryStore,
  streamingBlobBackend,
} from './contracts'
import {
  assertDigest,
  validateArtifactBlob,
  validateImageAsset,
  validateStoredSnapshot,
  verifiedAssetStream,
} from './validation'
import { putImmutableObject } from './immutable'
import { VersionedJSONState } from './versioned-state'
import { MAX_REGISTRY_PACKAGE_RELEASE_BYTES, MAX_REGISTRY_SNAPSHOT_BYTES } from '../budget'
import { parsePackagePostinstall } from '../package-manifest'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const MAX_REGISTRY_STATE_BYTES = 256 * 1024

const summaryCountsSchema = z.object({
  skill_count: z.number().check(z.int(), z.minimum(0)),
  package_count: z.number().check(z.int(), z.minimum(0)),
  category_count: z.number().check(z.int(), z.minimum(0)),
  skipped_package_count: z.number().check(z.int(), z.minimum(0)),
})

function validateState(state: SkillRegistryState, id: string) {
  if (state.schema_version !== '1' || state.definition?.id !== id) {
    throw new Error(`Invalid Registry state: ${id}`)
  }
  if (!state.current_snapshot) {
    if (state.current_summary) throw new Error(`Registry state has a summary without a Snapshot: ${id}`)
    return
  }
  assertDigest(state.current_snapshot)
  const summary = state.current_summary
  if (!summary || summary.revision !== state.current_snapshot
    || !summary.source_revision || !Number.isFinite(Date.parse(summary.published_at))) {
    throw new Error(`Registry state has an invalid current summary: ${id}`)
  }
  if (!summaryCountsSchema.safeParse(summary).success) {
    throw new Error(`Registry state has invalid summary counts: ${id}`)
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
}

async function readJSON<T>(backend: BlobBackend, key: string, maxBytes: number): Promise<T | null> {
  const value = await backend.get(key)
  if (!value) return null
  if (value.length > maxBytes) throw new Error(`Stored JSON object exceeds ${maxBytes} bytes: ${key}`)
  return JSON.parse(decoder.decode(value)) as T
}

export class BlobSkillRegistryStore implements SkillRegistryStore {
  private readonly streamingBackend
  private readonly stateStore

  constructor(protected readonly backend: BlobBackend) {
    this.streamingBackend = streamingBlobBackend(backend)
    this.stateStore = new VersionedJSONState(backend, {
      label: 'Registry state',
      maxBytes: MAX_REGISTRY_STATE_BYTES,
      normalizeID: (id) => assertRegistryID(id, 'registry ID'),
      stateID: (state: SkillRegistryState) => state.definition.id,
      key: (id) => `skill-registries/${id}/state.json`,
      validate: validateState,
    })
  }

  async listRegistryIDs(): Promise<string[]> {
    const prefixes = await this.backend.listPrefixes('skill-registries/')
    return [...new Set(prefixes.flatMap((prefix): string[] => {
      const match = prefix.match(/^skill-registries\/([^/]+)\/$/)
      return match?.[1] ? [match[1]] : []
    }))].sort()
  }

  async getState(registryID: string) {
    return (await this.getStateWithVersion(registryID)).state
  }

  // Paired with putState's expectedVersion: callers that need to detect a
  // concurrent publish read the version here first, then pass it back to
  // putState so a stale write is rejected instead of silently clobbering.
  async getStateWithVersion(registryID: string): Promise<SkillRegistryStateRead> {
    return this.stateStore.get(registryID)
  }

  async putState(state: SkillRegistryState, expectedVersion?: string | null) {
    await this.stateStore.put(state, expectedVersion)
  }

  async getSnapshot(registryID: string, revision: string) {
    const id = assertRegistryID(registryID, 'registry ID')
    const digest = assertDigest(revision)
    const key = `skill-registries/${id}/snapshots/${digest}.json`
    const bytes = await this.backend.get(key)
    if (!bytes) return null
    if (bytes.length > MAX_REGISTRY_SNAPSHOT_BYTES) {
      throw new Error(`Stored JSON object exceeds ${MAX_REGISTRY_SNAPSHOT_BYTES} bytes: ${key}`)
    }
    if (registrySnapshotRevision(bytes) !== digest) {
      throw new Error(`Stored Snapshot content does not match its revision: ${key}`)
    }
    const snapshot = JSON.parse(decoder.decode(bytes)) as SkillRegistrySnapshot
    validateStoredSnapshot(snapshot, id, key)
    if (!sameBytes(bytes, serializeRegistrySnapshot(snapshot))) {
      throw new Error(`Stored Snapshot is not canonically serialized: ${key}`)
    }
    return snapshot
  }

  async putPackageRelease(release: SkillPackageRelease) {
    const id = assertRegistryID(release.registry_id, 'registry ID')
    const packageID = assertRegistryComponentID(release.package_id, 'package ID')
    if (release.postinstall !== undefined) {
      parsePackagePostinstall(release.postinstall, `Package release ${id}/${packageID}`)
    }
    const bytes = serializeSkillPackageRelease(release)
    if (bytes.length > MAX_REGISTRY_PACKAGE_RELEASE_BYTES) {
      throw new Error(`Package release exceeds ${MAX_REGISTRY_PACKAGE_RELEASE_BYTES} bytes: ${id}/${packageID}`)
    }
    const revision = assertDigest(skillPackageRevision(release))
    const key = `skill-registries/${id}/packages/${packageID}/${revision}.json`
    return { revision, stored: await putImmutableObject(this.backend, key, bytes, 'Package release') }
  }

  async getPackageRelease(registryID: string, packageID: string, revision: string) {
    const id = assertRegistryID(registryID, 'registry ID')
    const normalizedPackageID = assertRegistryComponentID(packageID, 'package ID')
    const digest = assertDigest(revision)
    const key = `skill-registries/${id}/packages/${normalizedPackageID}/${digest}.json`
    const bytes = await this.backend.get(key)
    if (!bytes) return null
    if (bytes.length > MAX_REGISTRY_PACKAGE_RELEASE_BYTES) {
      throw new Error(`Stored Package release exceeds ${MAX_REGISTRY_PACKAGE_RELEASE_BYTES} bytes: ${key}`)
    }
    const release = JSON.parse(decoder.decode(bytes)) as SkillPackageRelease
    if (release.schema_version !== '1' || release.registry_id !== id || release.package_id !== normalizedPackageID
      || skillPackageRevision(release) !== digest || !sameBytes(bytes, serializeSkillPackageRelease(release))) {
      throw new Error(`Invalid stored Package release: ${key}`)
    }
    if (release.postinstall !== undefined) {
      parsePackagePostinstall(release.postinstall, `Stored Package release ${id}/${normalizedPackageID}`)
    }
    return release
  }

  async publishSnapshot(
    bytes: Uint8Array,
    definition: SkillRegistryState['definition'],
    options: { expectedVersion?: string | null; publishedAt?: string } = {},
  ) {
    const id = assertRegistryID(definition.id, 'registry ID')
    if (bytes.length > MAX_REGISTRY_SNAPSHOT_BYTES) {
      throw new Error(`Registry snapshot exceeds ${MAX_REGISTRY_SNAPSHOT_BYTES} bytes: ${id}`)
    }
    const snapshot = JSON.parse(decoder.decode(bytes)) as SkillRegistrySnapshot
    validateStoredSnapshot(snapshot, id, `registries/${id}/snapshot.json`)
    if (!sameBytes(bytes, serializeRegistrySnapshot(snapshot))) {
      throw new Error(`Registry Snapshot is not canonically serialized: ${id}`)
    }
    const revision = assertDigest(registrySnapshotRevision(bytes))
    const key = `skill-registries/${id}/snapshots/${revision}.json`
    await putImmutableObject(this.backend, key, bytes, 'Snapshot')
    const publishedAt = options.publishedAt ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(publishedAt))) throw new Error(`Invalid Snapshot publication time: ${publishedAt}`)
    await this.putState({
      schema_version: '1',
      definition,
      current_snapshot: revision,
      current_summary: summarizeCurrentSnapshot(snapshot, revision, publishedAt),
    }, options.expectedVersion)
    return revision
  }

  async putArtifact(descriptor: SkillArtifactDescriptor, bytes: Uint8Array) {
    assertDigest(descriptor.digest)
    if (descriptor.format !== 'memoh_skill_v1') throw new Error(`Unsupported artifact format: ${descriptor.format}`)
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1) throw new Error('Artifact has invalid compressed size')
    if (descriptor.size > MAX_SKILL_ARTIFACT_COMPRESSED_BYTES) throw new Error('Artifact exceeds compressed size limit')
    if (descriptor.size !== bytes.length) throw new Error('Artifact size does not match its content')
    if (descriptor.digest !== await sha256(bytes)) throw new Error('Artifact digest does not match its content')
    const archiveKey = `skill-artifacts/${descriptor.digest}.tar.gz`
    return { stored: await putImmutableObject(this.backend, archiveKey, bytes, 'Artifact') }
  }

  async getArtifact(digest: string) {
    assertDigest(digest)
    const bytes = await this.backend.get(`skill-artifacts/${digest}.tar.gz`)
    if (!bytes) return null
    if (await sha256(bytes) !== digest) {
      throw new Error(`Stored Artifact content is corrupt: ${digest}`)
    }
    const descriptor: SkillArtifactBlob = {
      format: 'memoh_skill_v1', digest, size: bytes.length, content_type: 'application/gzip',
    }
    return { descriptor, bytes }
  }

  async getArtifactStream(digest: string) {
    assertDigest(digest)
    if (this.streamingBackend) {
      const streamed = await this.streamingBackend.getStream(`skill-artifacts/${digest}.tar.gz`)
      if (!streamed) return null
      if (streamed.size == null) throw new Error(`Stored Artifact size is unavailable: ${digest}`)
      const descriptor: SkillArtifactBlob = {
        format: 'memoh_skill_v1', digest, size: streamed.size, content_type: 'application/gzip',
      }
      validateArtifactBlob(descriptor, digest)
      return { descriptor, body: verifiedAssetStream(streamed.body, descriptor) }
    }
    const artifact = await this.getArtifact(digest)
    return artifact ? { descriptor: artifact.descriptor, body: artifact.bytes } : null
  }

  async putImage(descriptor: SkillImageAsset, bytes: Uint8Array) {
    const digest = assertDigest(descriptor.digest)
    validateImageAsset(descriptor, digest)
    if (bytes.length !== descriptor.size || await sha256(bytes) !== digest) {
      throw new Error('Skill image metadata does not match its content')
    }
    const metadataKey = `skill-images/${digest}.json`
    const imageKey = `skill-images/${digest}`
    const metadata = jsonBytes(descriptor)
    const storedMetadata = await this.backend.get(metadataKey)
    if (storedMetadata) {
      if (decoder.decode(storedMetadata) !== decoder.decode(metadata)) {
        throw new Error(`Skill image ${digest} metadata is immutable`)
      }
      const storedImage = await this.backend.get(imageKey)
      if (!storedImage) {
        await putImmutableObject(this.backend, imageKey, bytes, 'Skill image')
        return { stored: true }
      }
      if (storedImage.length !== bytes.length || await sha256(storedImage) !== digest) {
        throw new Error(`Skill image is immutable: ${imageKey}`)
      }
      return { stored: false }
    }
    const storedImage = await this.backend.get(imageKey)
    if (storedImage) {
      if (await sha256(storedImage) !== digest) throw new Error(`Skill image ${digest} content is immutable`)
    } else {
      await putImmutableObject(this.backend, imageKey, bytes, 'Skill image')
    }
    await putImmutableObject(this.backend, metadataKey, metadata, 'Skill image metadata')
    return { stored: !storedImage }
  }

  async getImage(digest: string) {
    assertDigest(digest)
    const [descriptor, bytes] = await Promise.all([
      readJSON<SkillImageAsset>(this.backend, `skill-images/${digest}.json`, MAX_REGISTRY_STATE_BYTES),
      this.backend.get(`skill-images/${digest}`),
    ])
    if (!descriptor || !bytes) return null
    validateImageAsset(descriptor, digest)
    if (bytes.length !== descriptor.size || await sha256(bytes) !== digest) throw new Error(`Stored Skill image is corrupt: ${digest}`)
    return { descriptor, bytes }
  }

  async getImageStream(digest: string) {
    assertDigest(digest)
    const descriptor = await readJSON<SkillImageAsset>(
      this.backend,
      `skill-images/${digest}.json`,
      MAX_REGISTRY_STATE_BYTES,
    )
    if (!descriptor) return null
    validateImageAsset(descriptor, digest)
    if (this.streamingBackend) {
      const streamed = await this.streamingBackend.getStream(`skill-images/${digest}`)
      if (!streamed) return null
      if (streamed.size != null && streamed.size !== descriptor.size) throw new Error(`Stored Skill image size is corrupt: ${digest}`)
      return { descriptor, body: verifiedAssetStream(streamed.body, descriptor, 'Skill image') }
    }
    const image = await this.getImage(digest)
    return image ? { descriptor: image.descriptor, body: image.bytes } : null
  }

}
