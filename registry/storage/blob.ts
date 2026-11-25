import type {
  SkillArtifactBlob,
  SkillArtifactDescriptor,
  SkillImageAsset,
  SkillRegistrySnapshot,
  SkillRegistryState,
  AppRelease,
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
  serializeAppRelease,
  appRevision,
} from '../snapshot'
import {
  type BlobBackend,
  type SkillRegistryStateRead,
  type SkillRegistryStore,
  type StoredRegistryRefs,
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
import { MAX_REGISTRY_APP_RELEASE_BYTES, MAX_REGISTRY_SNAPSHOT_BYTES } from '../budget'
import { parseAppPostinstall } from '../app-manifest'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const MAX_REGISTRY_STATE_BYTES = 256 * 1024

const ARTIFACTS_PREFIX = 'skill-artifacts/'
const IMAGES_PREFIX = 'skill-images/'
const artifactKey = (digest: string) => `${ARTIFACTS_PREFIX}${digest}.tar.gz`
const imageKey = (digest: string) => `${IMAGES_PREFIX}${digest}`
const imageMetadataKey = (digest: string) => `${IMAGES_PREFIX}${digest}.json`
const appReleaseKey = (registryID: string, appID: string, revision: string) => `app-registries/${registryID}/apps/${appID}/${revision}.json`
const appReleasesPrefix = (registryID: string) => `app-registries/${registryID}/apps/`

const digestPattern = /^[0-9a-f]{64}$/

function parseArtifactKey(key: string): string | undefined {
  if (!key.startsWith(ARTIFACTS_PREFIX) || !key.endsWith('.tar.gz')) return undefined
  const digest = key.slice(ARTIFACTS_PREFIX.length, -'.tar.gz'.length)
  return digestPattern.test(digest) ? digest : undefined
}

function parseImageObjectKey(key: string): string | undefined {
  if (!key.startsWith(IMAGES_PREFIX) || key.endsWith('.json')) return undefined
  const digest = key.slice(IMAGES_PREFIX.length)
  return digestPattern.test(digest) ? digest : undefined
}

function parseImageMetadataKey(key: string): string | undefined {
  if (!key.startsWith(IMAGES_PREFIX) || !key.endsWith('.json')) return undefined
  const digest = key.slice(IMAGES_PREFIX.length, -'.json'.length)
  return digestPattern.test(digest) ? digest : undefined
}

function parseAppReleaseKey(registryID: string, key: string): { appID: string; revision: string } | undefined {
  const prefix = appReleasesPrefix(registryID)
  if (!key.startsWith(prefix) || !key.endsWith('.json')) return undefined
  const relative = key.slice(prefix.length, -'.json'.length)
  const separator = relative.lastIndexOf('/')
  if (separator <= 0) return undefined
  const appID = relative.slice(0, separator)
  const revision = relative.slice(separator + 1)
  if (!digestPattern.test(revision)) return undefined
  try {
    assertRegistryComponentID(appID, 'app ID')
  } catch {
    return undefined
  }
  return { appID, revision }
}

const summaryCountsSchema = z.object({
  skill_count: z.number().check(z.int(), z.minimum(0)),
  app_count: z.number().check(z.int(), z.minimum(0)),
  category_count: z.number().check(z.int(), z.minimum(0)),
  skipped_app_count: z.number().check(z.int(), z.minimum(0)),
})

function validateState(state: SkillRegistryState, id: string) {
  if (state.schema_version !== '2' || state.definition?.id !== id) {
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

// Schema 2 state must not read or overwrite the schema 1 skill-registries namespace.
// Keeping separate pointers also preserves the old data for a service rollback.
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
      key: (id) => `app-registries/${id}/state.json`,
      validate: validateState,
    })
  }

  async listRegistryIDs(): Promise<string[]> {
    const prefixes = await this.backend.listPrefixes('app-registries/')
    return [...new Set(prefixes.flatMap((prefix): string[] => {
      const match = prefix.match(/^app-registries\/([^/]+)\/$/)
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
    const key = `app-registries/${id}/snapshots/${digest}.json`
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

  async putAppRelease(release: AppRelease) {
    const id = assertRegistryID(release.registry_id, 'registry ID')
    const appID = assertRegistryComponentID(release.app_id, 'app ID')
    if (release.postinstall !== undefined) {
      parseAppPostinstall(release.postinstall, `App release ${id}/${appID}`)
    }
    const bytes = serializeAppRelease(release)
    if (bytes.length > MAX_REGISTRY_APP_RELEASE_BYTES) {
      throw new Error(`App release exceeds ${MAX_REGISTRY_APP_RELEASE_BYTES} bytes: ${id}/${appID}`)
    }
    const revision = assertDigest(appRevision(release))
    const key = appReleaseKey(id, appID, revision)
    return { revision, stored: await putImmutableObject(this.backend, key, bytes, 'App release') }
  }

  async listStoredRefs(registryID: string): Promise<StoredRegistryRefs> {
    const id = assertRegistryID(registryID, 'registry ID')
    const [artifactKeys, imageKeys, releaseKeys] = await Promise.all([
      this.backend.list(ARTIFACTS_PREFIX),
      this.backend.list(IMAGES_PREFIX),
      this.backend.list(appReleasesPrefix(id)),
    ])
    const artifacts = new Set<string>()
    for (const key of artifactKeys) {
      const digest = parseArtifactKey(key)
      if (digest) artifacts.add(digest)
    }
    const imageObjects = new Set<string>()
    const imageMetadata = new Set<string>()
    for (const key of imageKeys) {
      const objectDigest = parseImageObjectKey(key)
      if (objectDigest) imageObjects.add(objectDigest)
      const metadataDigest = parseImageMetadataKey(key)
      if (metadataDigest) imageMetadata.add(metadataDigest)
    }
    // putImage writes the image object before its metadata. A crash (or a
    // restore that lost only .json files) can leave the object without its
    // metadata, which getImage cannot serve; only the complete pair is safe
    // to skip, otherwise putImage must run again to heal it.
    const images = new Set<string>()
    for (const digest of imageObjects) {
      if (imageMetadata.has(digest)) images.add(digest)
    }
    const appReleases = new Map<string, Set<string>>()
    for (const key of releaseKeys) {
      const parsed = parseAppReleaseKey(id, key)
      if (!parsed) continue
      const revisions = appReleases.get(parsed.appID)
      if (revisions) revisions.add(parsed.revision)
      else appReleases.set(parsed.appID, new Set([parsed.revision]))
    }
    return { artifacts, images, appReleases }
  }

  async getAppRelease(registryID: string, appID: string, revision: string) {
    const id = assertRegistryID(registryID, 'registry ID')
    const normalizedAppID = assertRegistryComponentID(appID, 'app ID')
    const digest = assertDigest(revision)
    const key = appReleaseKey(id, normalizedAppID, digest)
    const bytes = await this.backend.get(key)
    if (!bytes) return null
    if (bytes.length > MAX_REGISTRY_APP_RELEASE_BYTES) {
      throw new Error(`Stored App release exceeds ${MAX_REGISTRY_APP_RELEASE_BYTES} bytes: ${key}`)
    }
    const release = JSON.parse(decoder.decode(bytes)) as AppRelease
    if (release.schema_version !== '2' || release.registry_id !== id || release.app_id !== normalizedAppID
      || appRevision(release) !== digest || !sameBytes(bytes, serializeAppRelease(release))) {
      throw new Error(`Invalid stored App release: ${key}`)
    }
    if (release.postinstall !== undefined) {
      parseAppPostinstall(release.postinstall, `Stored App release ${id}/${normalizedAppID}`)
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
    const key = `app-registries/${id}/snapshots/${revision}.json`
    await putImmutableObject(this.backend, key, bytes, 'Snapshot')
    const publishedAt = options.publishedAt ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(publishedAt))) throw new Error(`Invalid Snapshot publication time: ${publishedAt}`)
    await this.putState({
      schema_version: '2',
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
    const archiveKey = artifactKey(descriptor.digest)
    return { stored: await putImmutableObject(this.backend, archiveKey, bytes, 'Artifact') }
  }

  async getArtifact(digest: string) {
    assertDigest(digest)
    const bytes = await this.backend.get(artifactKey(digest))
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
      const streamed = await this.streamingBackend.getStream(artifactKey(digest))
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
    const metadataKey = imageMetadataKey(digest)
    const imageObjectKey = imageKey(digest)
    const metadata = jsonBytes(descriptor)
    const storedMetadata = await this.backend.get(metadataKey)
    if (storedMetadata) {
      if (decoder.decode(storedMetadata) !== decoder.decode(metadata)) {
        throw new Error(`Skill image ${digest} metadata is immutable`)
      }
      const storedImage = await this.backend.get(imageObjectKey)
      if (!storedImage) {
        await putImmutableObject(this.backend, imageObjectKey, bytes, 'Skill image')
        return { stored: true }
      }
      if (storedImage.length !== bytes.length || await sha256(storedImage) !== digest) {
        throw new Error(`Skill image is immutable: ${imageObjectKey}`)
      }
      return { stored: false }
    }
    const storedImage = await this.backend.get(imageObjectKey)
    if (storedImage) {
      if (await sha256(storedImage) !== digest) throw new Error(`Skill image ${digest} content is immutable`)
    } else {
      await putImmutableObject(this.backend, imageObjectKey, bytes, 'Skill image')
    }
    await putImmutableObject(this.backend, metadataKey, metadata, 'Skill image metadata')
    return { stored: !storedImage }
  }

  async getImage(digest: string) {
    assertDigest(digest)
    const [descriptor, bytes] = await Promise.all([
      readJSON<SkillImageAsset>(this.backend, imageMetadataKey(digest), MAX_REGISTRY_STATE_BYTES),
      this.backend.get(imageKey(digest)),
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
      imageMetadataKey(digest),
      MAX_REGISTRY_STATE_BYTES,
    )
    if (!descriptor) return null
    validateImageAsset(descriptor, digest)
    if (this.streamingBackend) {
      const streamed = await this.streamingBackend.getStream(imageKey(digest))
      if (!streamed) return null
      if (streamed.size != null && streamed.size !== descriptor.size) throw new Error(`Stored Skill image size is corrupt: ${digest}`)
      return { descriptor, body: verifiedAssetStream(streamed.body, descriptor, 'Skill image') }
    }
    const image = await this.getImage(digest)
    return image ? { descriptor: image.descriptor, body: image.bytes } : null
  }

}
