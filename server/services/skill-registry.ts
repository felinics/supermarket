import type {
  CatalogSkill,
  SkillArtifactDescriptor,
  SkillRegistryState,
  SkillRegistrySnapshot,
  SkillRegistrySummary,
} from '#registry/types'
import type { SkillCatalogSearchOptions } from '#registry/catalog'
import { searchCatalogSkills, summarizeAppCategories } from '#registry/catalog'
import type { AppSearchOptions } from '#registry/apps'
import { catalogAppsFromSnapshot, appDescriptorFromRelease, searchApps } from '#registry/apps'
import { catalogSkillsFromSnapshot } from '#registry/snapshot'
import { R2BlobBackend } from '#registry/storage/r2'
import { BlobSkillRegistryStore } from '#registry/storage/blob'
import type { SkillRegistryStore } from '#registry/storage/contracts'
import { RegistrySnapshotCache } from './registry-snapshot-cache'
import { createRuntimeStoreResolver, type RuntimeStoreEvent } from './runtime-store'

const snapshotCaches = new WeakMap<object, RegistrySnapshotCache>()

type RuntimeEvent = RuntimeStoreEvent

function snapshotCache(store: SkillRegistryStore) {
  let cache = snapshotCaches.get(store)
  if (!cache) {
    cache = new RegistrySnapshotCache()
    snapshotCaches.set(store, cache)
  }
  return cache
}

function cachedSnapshot(store: SkillRegistryStore, registryID: string, revision: string) {
  return snapshotCache(store).get(store, registryID, revision)
}

export const getRuntimeSkillRegistryStore = createRuntimeStoreResolver<SkillRegistryStore>({
  remote: (bucket) => new BlobSkillRegistryStore(new R2BlobBackend(bucket)),
  local: () => import('#registry/storage/local')
    .then(({ LocalSkillRegistryStore }) => new LocalSkillRegistryStore()),
})

export async function getEnabledSkillRegistrySnapshots(
  store: SkillRegistryStore,
  registryID?: string,
): Promise<SkillRegistrySnapshot[]> {
  const ids = registryID ? [registryID] : await store.listRegistryIDs()
  const cache = snapshotCache(store)
  const snapshots = await Promise.all(ids.map(async (id) => {
    const state = await store.getState(id)
    if (!state?.definition.enabled || !state.current_snapshot) return null
    const snapshot = await cachedSnapshot(store, id, state.current_snapshot)
    if (!snapshot) throw new Error(`Current Registry snapshot is missing: ${id}/${state.current_snapshot}`)
    return snapshot
  }))
  const values = snapshots.filter((snapshot): snapshot is SkillRegistrySnapshot => snapshot !== null)
  cache.assertRequestBudget(values)
  return values
}

function artifactResponse(descriptor: SkillArtifactDescriptor) {
  return { ...descriptor, download_url: `/api/artifacts/skill/${descriptor.digest}` }
}

export function publicCatalogSkill<T extends Pick<CatalogSkill, 'artifact'> & { registry_priority?: number }>(skill: T) {
  const { registry_priority: _priority, ...value } = skill
  return { ...value, artifact: artifactResponse(skill.artifact) }
}

export async function getCatalogSkills(event: RuntimeEvent, options: SkillCatalogSearchOptions = {}) {
  const store = await getRuntimeSkillRegistryStore(event)
  const skills = (await getEnabledSkillRegistrySnapshots(store, options.registry)).flatMap(catalogSkillsFromSnapshot)
  return publicCatalogSearch(skills, options)
}

function publicCatalogSearch(skills: CatalogSkill[], options: SkillCatalogSearchOptions) {
  const result = searchCatalogSkills(skills, options)
  return { ...result, data: result.data.map(publicCatalogSkill) }
}

function publicAppSummary<T extends { registry_priority: number }>(pkg: T) {
  const { registry_priority: _priority, ...value } = pkg
  return value
}

function publicAppSearch(apps: ReturnType<typeof catalogAppsFromSnapshot>, options: AppSearchOptions) {
  const result = searchApps(apps, options)
  return { ...result, data: result.data.map(publicAppSummary) }
}

export async function getApps(event: RuntimeEvent, options: AppSearchOptions = {}) {
  const snapshots = await getEnabledSkillRegistrySnapshots(await getRuntimeSkillRegistryStore(event), options.registry)
  return publicAppSearch(snapshots.flatMap(catalogAppsFromSnapshot), options)
}

async function getScopedRegistrySnapshot(store: SkillRegistryStore, registryID: string) {
  const state = await store.getState(registryID)
  if (!state?.definition.enabled) return undefined
  if (!state.current_snapshot) return null
  const snapshot = await cachedSnapshot(store, registryID, state.current_snapshot)
  if (!snapshot) throw new Error(`Current Registry snapshot is missing: ${registryID}/${state.current_snapshot}`)
  snapshotCache(store).assertRequestBudget([snapshot])
  return snapshot
}

export async function getRegistryApps(
  event: RuntimeEvent,
  registryID: string,
  options: AppSearchOptions = {},
) {
  const snapshot = await getScopedRegistrySnapshot(await getRuntimeSkillRegistryStore(event), registryID)
  if (snapshot === undefined) return undefined
  return publicAppSearch(snapshot ? catalogAppsFromSnapshot(snapshot) : [], {
    ...options,
    registry: registryID,
  })
}

function publicAppDescriptor(descriptor: ReturnType<typeof appDescriptorFromRelease>) {
  return { ...descriptor, skills: descriptor.skills.map(publicCatalogSkill) }
}

export async function getCurrentApp(
  event: RuntimeEvent,
  registryID: string,
  appID: string,
) {
  const store = await getRuntimeSkillRegistryStore(event)
  const state = await store.getState(registryID)
  if (!state?.definition.enabled || !state.current_snapshot) return undefined
  const snapshot = await cachedSnapshot(store, registryID, state.current_snapshot)
  if (!snapshot) throw new Error(`Current Registry snapshot is missing: ${registryID}/${state.current_snapshot}`)
  snapshotCache(store).assertRequestBudget([snapshot])
  const pkg = snapshot.apps.find((item) => item.app_id === appID)
  if (!pkg) return undefined
  const release = await store.getAppRelease(registryID, appID, pkg.revision)
  if (!release) throw new Error(`Current App release is missing: ${registryID}/${appID}/${pkg.revision}`)
  return publicAppDescriptor(appDescriptorFromRelease(release, pkg.revision))
}

export async function getAppRelease(
  event: RuntimeEvent,
  registryID: string,
  appID: string,
  revision: string,
) {
  const store = await getRuntimeSkillRegistryStore(event)
  return store.getAppRelease(registryID, appID, revision)
}

export async function getRegistryCatalogSkills(
  event: RuntimeEvent,
  registryID: string,
  options: SkillCatalogSearchOptions = {},
) {
  const snapshot = await getScopedRegistrySnapshot(await getRuntimeSkillRegistryStore(event), registryID)
  if (snapshot === undefined) return undefined
  return publicCatalogSearch(snapshot ? catalogSkillsFromSnapshot(snapshot) : [], {
    ...options,
    registry: registryID,
  })
}

export async function getCatalogSkill(event: RuntimeEvent, registryID: string, appID: string, skillID: string) {
  const [snapshot] = await getEnabledSkillRegistrySnapshots(await getRuntimeSkillRegistryStore(event), registryID)
  return snapshot && catalogSkillsFromSnapshot(snapshot)
    .find((skill) => skill.app_id === appID && skill.skill_id === skillID)
}

export async function getSkillRegistrySummaries(event: RuntimeEvent): Promise<SkillRegistrySummary[]> {
  return getSkillRegistrySummariesForStore(await getRuntimeSkillRegistryStore(event))
}

export async function getSkillRegistrySummariesForStore(store: SkillRegistryStore): Promise<SkillRegistrySummary[]> {
  const ids = await store.listRegistryIDs()
  const values = await Promise.all(ids.map((id) => getSkillRegistrySummary(store, id)))
  const summaries = values.filter((summary): summary is SkillRegistrySummary => summary !== null)
  return summaries.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
}

async function getSkillRegistrySummary(
  store: SkillRegistryStore,
  registryID: string,
): Promise<SkillRegistrySummary | null> {
  const state = await store.getState(registryID)
  return state ? publicRegistrySummary(state) : null
}

function publicRegistrySummary(state: SkillRegistryState): SkillRegistrySummary | null {
  const registry = state.definition
  if (!registry.enabled) return null
  const current = state.current_summary
  return {
    id: registry.id, name: registry.name, enabled: registry.enabled, priority: registry.priority,
    adapter: registry.adapter.type, revision: current?.revision, published_at: current?.published_at,
    skill_count: current?.skill_count ?? 0,
    app_count: current?.app_count ?? 0,
    category_count: current?.category_count ?? 0,
    skipped_app_count: current?.skipped_app_count ?? 0,
  }
}

export async function getSkillRegistryDetails(event: RuntimeEvent, registryID: string) {
  return getSkillRegistryDetailsForStore(await getRuntimeSkillRegistryStore(event), registryID)
}

export async function getSkillRegistryDetailsForStore(store: SkillRegistryStore, registryID: string) {
  const state = await store.getState(registryID)
  if (!state) return undefined
  const summary = publicRegistrySummary(state)
  if (!summary) return undefined
  const snapshot = state.current_snapshot ? await cachedSnapshot(store, registryID, state.current_snapshot) : null
  return { ...summary, definition: state.definition, source_revision: snapshot?.source.revision, diagnostics: snapshot?.diagnostics ?? [] }
}

/**
 * App categories with localized names. Without a registry the result
 * spans every enabled Registry; with one it is scoped and `undefined` marks an
 * unknown or disabled Registry.
 */
export async function getAppCategories(event: RuntimeEvent, registryID?: string) {
  const store = await getRuntimeSkillRegistryStore(event)
  if (!registryID) return summarizeAppCategories(await getEnabledSkillRegistrySnapshots(store))
  const snapshot = await getScopedRegistrySnapshot(store, registryID)
  if (snapshot === undefined) return undefined
  return summarizeAppCategories(snapshot ? [snapshot] : [])
}
