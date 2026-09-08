import { assertDigest, sha256 } from '#lib/digest'
import type { BlobBackend } from '../storage/contracts'
import { putImmutableObject } from '../storage/immutable'
import { VersionedJSONState } from '../storage/versioned-state'
import { BlobSkillRegistryStore } from '../storage/blob'
import { DEPENDENCY_REGISTRY, MAX_DEPENDENCY_BYTES, MAX_DEPENDENCY_FILES, MAX_DEPENDENCY_INDEX_BYTES,
  MAX_DEPENDENCIES, dependencyJSON, parseDependencyManifest, validateDependencyGraph,
  type DependencyRelease, type DependencySnapshot, type DependencyRegistryState,
} from './types'
import type { buildDependencyCandidate } from './build'

function officialRegistry(id: string) {
  if (id !== DEPENDENCY_REGISTRY) throw new Error('Unsupported dependency registry')
  return id
}

export function validateDependencyRelease(release: DependencyRelease) {
  if (release.schema_version !== '1' || release.registry_id !== DEPENDENCY_REGISTRY) throw new Error('Invalid dependency release')
  const manifest = parseDependencyManifest(release.manifest)
  if (manifest.id !== release.dependency_id || !/^sha256:[a-f0-9]{64}$/.test(release.manifest_digest)) throw new Error('Invalid dependency release identity')
  const artifact = release.artifact
  if (artifact?.format !== 'memoh_dependency_v1' || artifact.content_type !== 'application/gzip') throw new Error('Invalid dependency artifact format')
  assertDigest(artifact.digest)
  for (const size of [artifact.size, artifact.uncompressed_size, artifact.archive_size]) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_DEPENDENCY_BYTES) throw new Error('Invalid dependency artifact budget')
  }
  if (!Number.isSafeInteger(artifact.file_count) || artifact.file_count < 1 || artifact.file_count > MAX_DEPENDENCY_FILES) throw new Error('Invalid dependency file count')
  if (release.icon) {
    assertDigest(release.icon.digest)
    if (release.icon.content_type !== 'image/svg+xml' || !Number.isSafeInteger(release.icon.size) || release.icon.size <= 0 || release.icon.size > 512 * 1024) throw new Error('Invalid dependency icon')
  }
}

export class DependencyRegistryStore {
  private readonly state: VersionedJSONState<DependencyRegistryState>
  constructor(private readonly backend: BlobBackend) {
    this.state = new VersionedJSONState(backend, {
      label: 'Dependency registry state', maxBytes: 4096,
      normalizeID: officialRegistry, stateID: (value) => value.registry_id,
      // Independent pointer: publishing Skills and Dependencies cannot
      // overwrite each other's current revision, even on a local backend.
      key: (id) => `dependency-registries/${id}/state.json`,
      validate: (value) => {
        if (value.schema_version !== '1' || typeof value.enabled !== 'boolean') throw new Error('Invalid dependency registry state')
        if (value.current_snapshot) assertDigest(value.current_snapshot)
      },
    })
  }

  async current() {
    const { state } = await this.state.get(DEPENDENCY_REGISTRY)
    if (!state?.enabled || !state.current_snapshot) return null
    const key = `dependency-registries/${DEPENDENCY_REGISTRY}/snapshots/${state.current_snapshot}.json`
    const bytes = await this.readVerified(key, state.current_snapshot, MAX_DEPENDENCY_INDEX_BYTES)
    if (!bytes) throw new Error('Published dependency snapshot is missing')
    const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as DependencySnapshot
    if (snapshot.schema_version !== '1' || snapshot.registry_id !== DEPENDENCY_REGISTRY || !Array.isArray(snapshot.dependencies) || snapshot.dependencies.length > MAX_DEPENDENCIES) throw new Error('Invalid dependency snapshot')
    for (const descriptor of snapshot.dependencies) {
      const { revision, ...release } = descriptor
      validateDependencyRelease(release)
      if (await sha256(dependencyJSON(release)) !== assertDigest(revision)) throw new Error('Dependency descriptor revision mismatch')
    }
    validateDependencyGraph(snapshot.dependencies.map((entry) => entry.manifest))
    return { snapshot, revision: state.current_snapshot, published_at: state.published_at }
  }

  async release(id: string, revision: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 80) throw new Error('Invalid dependency ID')
    const digest = assertDigest(revision)
    const bytes = await this.readVerified(`dependency-registries/memoh/releases/${id}/${digest}.json`, digest, MAX_DEPENDENCY_BYTES)
    if (!bytes) return null
    const release = JSON.parse(new TextDecoder().decode(bytes)) as DependencyRelease
    validateDependencyRelease(release)
    if (release.dependency_id !== id) throw new Error('Dependency release identity mismatch')
    return { release, bytes }
  }

  async artifact(digest: string) {
    const bytes = await this.readVerified(`artifacts/dependency/${assertDigest(digest)}.tar.gz`, digest, MAX_DEPENDENCY_BYTES)
    return bytes ? { descriptor: { digest, size: bytes.length, content_type: 'application/gzip' }, body: bytes } : null
  }

  async publish(candidate: Awaited<ReturnType<typeof buildDependencyCandidate>>, enabled = true) {
    const read = await this.state.get(DEPENDENCY_REGISTRY)
    const version = read.versioning === 'conditional' ? read.version : undefined
    if (!enabled) {
      await this.state.put({ ...read.state, schema_version: '1', registry_id: DEPENDENCY_REGISTRY, enabled: false }, version)
      return
    }
    const images = new BlobSkillRegistryStore(this.backend)
    for (const release of candidate.releases) {
      validateDependencyRelease(release)
      const bytes = dependencyJSON(release)
      const revision = await sha256(bytes)
      const artifact = candidate.artifacts.get(release.artifact.digest)
      if (!artifact || artifact.length !== release.artifact.size || await sha256(artifact) !== release.artifact.digest) throw new Error('Missing or invalid dependency artifact')
      await putImmutableObject(this.backend, `artifacts/dependency/${release.artifact.digest}.tar.gz`, artifact, 'Dependency artifact')
      if (release.icon) {
        const icon = candidate.icons.get(release.icon.digest)
        if (!icon) throw new Error('Missing dependency icon')
        await images.putImage(release.icon, icon)
      }
      await putImmutableObject(this.backend, `dependency-registries/memoh/releases/${release.dependency_id}/${revision}.json`, bytes, 'Dependency release')
    }
    if (await sha256(candidate.bytes) !== candidate.revision) throw new Error('Dependency snapshot revision mismatch')
    await putImmutableObject(this.backend, `dependency-registries/memoh/snapshots/${candidate.revision}.json`, candidate.bytes, 'Dependency snapshot')
    await this.state.put({ schema_version: '1', registry_id: DEPENDENCY_REGISTRY, enabled,
      current_snapshot: candidate.revision, published_at: new Date().toISOString(),
    }, version)
  }

  private async readVerified(key: string, digest: string, budget: number) {
    const bytes = await this.backend.get(key)
    if (!bytes) return null
    if (bytes.length > budget || await sha256(bytes) !== digest) throw new Error(`Invalid stored dependency object: ${key}`)
    return bytes
  }
}
