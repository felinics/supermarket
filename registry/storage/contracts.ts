import type {
  SkillArtifactBlob,
  SkillArtifactDescriptor,
  SkillImageAsset,
  SkillRegistrySnapshot,
  SkillRegistryState,
  AppRelease,
} from '../types'

export interface BlobBackend {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, value: Uint8Array): Promise<void>
  list(prefix: string): Promise<string[]>
  listPrefixes(prefix: string): Promise<string[]>
}

export interface StreamingBlobBackend extends BlobBackend {
  getStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null>
}

export interface ConditionalBlobBackend extends BlobBackend {
  getWithVersion(key: string): Promise<{ value: Uint8Array; version: string } | null>
  putConditional(key: string, value: Uint8Array, expectedVersion: string | null): Promise<string | null>
}

export function streamingBlobBackend(backend: BlobBackend) {
  const candidate = backend as BlobBackend & Partial<StreamingBlobBackend>
  return typeof candidate.getStream === 'function'
    ? candidate as StreamingBlobBackend
    : undefined
}

export function conditionalBlobBackend(backend: BlobBackend) {
  const candidate = backend as BlobBackend & Partial<ConditionalBlobBackend>
  const canReadVersion = typeof candidate.getWithVersion === 'function'
  const canWriteConditionally = typeof candidate.putConditional === 'function'
  if (canReadVersion !== canWriteConditionally) {
    throw new Error('Blob backend must implement getWithVersion and putConditional together')
  }
  return canReadVersion ? candidate as ConditionalBlobBackend : undefined
}

export type VersionedStateRead<State> =
  | { state: State | null; versioning: 'none' }
  | { state: State | null; versioning: 'conditional'; version: string | null }

export type SkillRegistryStateRead = VersionedStateRead<SkillRegistryState>

/**
 * Digest-addressed objects the store can observe: Skill Artifacts and Skill
 * images under their bucket-global prefixes (shared across Registries because
 * the objects are content-addressed), plus every stored App release revision
 * under the given Registry's own prefix. This is the source of truth for
 * incremental publication, replacing any assumption that previously published
 * objects are still present.
 */
export interface StoredRegistryRefs {
  artifacts: ReadonlySet<string>
  images: ReadonlySet<string>
  /** Old revisions remain in the store because App releases are immutable. */
  appReleases: ReadonlyMap<string, ReadonlySet<string>>
}

export interface SkillRegistryStore {
  listRegistryIDs(): Promise<string[]>
  getState(registryID: string): Promise<SkillRegistryState | null>
  getStateWithVersion(registryID: string): Promise<SkillRegistryStateRead>
  putState(state: SkillRegistryState, expectedVersion?: string | null): Promise<void>
  getSnapshot(registryID: string, revision: string): Promise<SkillRegistrySnapshot | null>
  listStoredRefs(registryID: string): Promise<StoredRegistryRefs>
  putAppRelease(release: AppRelease): Promise<{ revision: string; stored: boolean }>
  getAppRelease(registryID: string, appID: string, revision: string): Promise<AppRelease | null>
  publishSnapshot(
    bytes: Uint8Array,
    definition: SkillRegistryState['definition'],
    options?: { expectedVersion?: string | null; publishedAt?: string },
  ): Promise<string>
  putArtifact(descriptor: SkillArtifactDescriptor, bytes: Uint8Array): Promise<{ stored: boolean }>
  getArtifact(digest: string): Promise<{ descriptor: SkillArtifactBlob; bytes: Uint8Array } | null>
  getArtifactStream?(digest: string): Promise<{
    descriptor: SkillArtifactBlob
    body: ReadableStream<Uint8Array> | Uint8Array
  } | null>
  putImage(descriptor: SkillImageAsset, bytes: Uint8Array): Promise<{ stored: boolean }>
  getImage(digest: string): Promise<{ descriptor: SkillImageAsset; bytes: Uint8Array } | null>
  getImageStream?(digest: string): Promise<{
    descriptor: SkillImageAsset
    body: ReadableStream<Uint8Array> | Uint8Array
  } | null>
}
