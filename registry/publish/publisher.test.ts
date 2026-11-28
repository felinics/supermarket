import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseGzipTarArchive } from '../../client/archive'
import type { AppRelease, SkillArtifactDescriptor, SkillImageAsset, SkillRegistryDefinition } from '../types'
import { LocalSkillRegistryStore } from '../storage/local'
import { buildSkillRegistryCandidate } from './candidate'
import type { RegistryReleaseLock } from './release-lock'
import { SkillRegistryPublisher, type SkillRegistryPublishProgress } from './publisher'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const definition: SkillRegistryDefinition = {
  schema_version: '1',
  id: 'memoh',
  name: 'Memoh',
  enabled: true,
  priority: 100,
  adapter: { type: 'skill_directory' },
  source: { type: 'local', path: 'skills' },
}

class CountingStore extends LocalSkillRegistryStore {
  appReleases: string[] = []
  artifacts = 0
  images = 0
  /** Apps whose stored release is hidden from listStoredRefs, as if lost. */
  hiddenAppReleases: string[] = []
  /** Stored Artifacts hidden from listStoredRefs, as if lost. */
  hideArtifacts = false
  /** Stored images hidden from listStoredRefs, as if lost. */
  hideImages = false
  /** Forces listStoredRefs to fail, exercising the full-upload fallback. */
  failListStoredRefs = false

  override async listStoredRefs(registryID: string) {
    if (this.failListStoredRefs) throw new Error('simulated list failure')
    const refs = await super.listStoredRefs(registryID)
    const appReleases = new Map(refs.appReleases)
    for (const appID of this.hiddenAppReleases) appReleases.delete(appID)
    return {
      artifacts: this.hideArtifacts ? new Set<string>() : refs.artifacts,
      images: this.hideImages ? new Set<string>() : refs.images,
      appReleases,
    }
  }

  override async putAppRelease(release: AppRelease) {
    this.appReleases.push(release.app_id)
    return super.putAppRelease(release)
  }

  override async putArtifact(descriptor: SkillArtifactDescriptor, bytes: Uint8Array) {
    this.artifacts += 1
    return super.putArtifact(descriptor, bytes)
  }

  override async putImage(descriptor: SkillImageAsset, bytes: Uint8Array) {
    this.images += 1
    return super.putImage(descriptor, bytes)
  }
}

async function writeSkill(projectRoot: string, description: string) {
  const directory = path.join(projectRoot, 'registries/memoh/skills/alpha')
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: Alpha\ndescription: ${description}\n---\n\n# Alpha\n`,
  )
}

const memohDefinition: SkillRegistryDefinition = {
  ...definition,
  adapter: { type: 'memoh' },
  source: { type: 'local', path: 'apps' },
}

async function writeApp(projectRoot: string, appID: string, description: string, icon: string) {
  const appRoot = path.join(projectRoot, 'registries/memoh/apps', appID)
  const skillRoot = path.join(appRoot, 'skills', appID)
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${appID}\ndescription: ${description}\n---\n\n# ${appID}\n`,
  )
  await writeFile(path.join(appRoot, 'icon.svg'), icon)
  await writeFile(path.join(appRoot, 'app.yaml'), `schema_version: "2"
id: ${appID}
version: 1.0.0
name: ${appID}
description: ${appID} app
icon: icon.svg
category: other
`)
}

async function releaseLock(
  projectRoot: string,
  currentDefinition = definition,
): Promise<RegistryReleaseLock> {
  const candidate = await buildSkillRegistryCandidate(currentDefinition, projectRoot)
  return { snapshot_revision: candidate.revision }
}

describe('SkillRegistryPublisher', () => {
  test('publishes immutable content before switching state and preserves last-known-good on failure', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-publisher-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-publisher-data-'))
    roots.push(projectRoot, dataRoot)
    await writeSkill(projectRoot, 'Version one')
    const lock = await releaseLock(projectRoot)
    const store = new LocalSkillRegistryStore(dataRoot)
    const events: SkillRegistryPublishProgress[] = []
    const publisher = new SkillRegistryPublisher(store, projectRoot, (event) => events.push(event))

    const first = await publisher.publish(definition, lock)
    expect(first).toMatchObject({ registry: 'memoh', skills: 1 })
    expect(events.map((event) => event.type)).toEqual([
      'source', 'source_ready', 'scanned', 'skill', 'app', 'publishing',
    ])
    const firstState = await store.getState('memoh')
    const firstSnapshot = await store.getSnapshot('memoh', firstState!.current_snapshot!)
    expect(firstSnapshot!.apps[0]!.skills[0]!.artifact.size).toBeGreaterThan(0)
    const artifact = await store.getArtifact(firstSnapshot!.apps[0]!.skills[0]!.artifact.digest)
    expect((await parseGzipTarArchive(artifact!.bytes)).has('SKILL.md')).toBe(true)

    expect(await publisher.publish(definition, lock)).toMatchObject({
      revision: first.revision,
      skipped: 'unchanged',
    })

    await writeFile(path.join(projectRoot, 'registries/memoh/skills/alpha/SKILL.md'), '# invalid')
    await expect(publisher.publish(definition, lock)).rejects.toThrow('frontmatter')
    expect((await store.getState('memoh'))?.current_snapshot).toBe(firstState?.current_snapshot)
  })

  test('publishes only Apps, Artifacts and images that changed since the previous Snapshot', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-incremental-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-incremental-data-'))
    roots.push(projectRoot, dataRoot)
    await writeApp(projectRoot, 'alpha', 'Alpha version one', '<svg xmlns="http://www.w3.org/2000/svg"><title>alpha</title></svg>')
    await writeApp(projectRoot, 'beta', 'Beta version one', '<svg xmlns="http://www.w3.org/2000/svg"><title>beta</title></svg>')
    const store = new CountingStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)

    const firstLock = await releaseLock(projectRoot, memohDefinition)
    await publisher.publish(memohDefinition, firstLock)
    expect(store.appReleases.sort()).toEqual(['alpha', 'beta'])
    expect(store.artifacts).toBe(2)
    expect(store.images).toBe(2)

    await writeApp(projectRoot, 'beta', 'Beta version two', '<svg xmlns="http://www.w3.org/2000/svg"><title>beta</title></svg>')
    const secondLock = await releaseLock(projectRoot, memohDefinition)
    store.appReleases = []
    store.artifacts = 0
    store.images = 0
    const second = await publisher.publish(memohDefinition, secondLock)
    expect(second.skipped).toBeUndefined()
    expect(store.appReleases).toEqual(['beta'])
    expect(store.artifacts).toBe(1)
    expect(store.images).toBe(0)
    expect((await store.getState('memoh'))?.current_snapshot).toBe(second.revision)

    // An unchanged publication still repairs objects missing from the store.
    store.appReleases = []
    store.artifacts = 0
    store.images = 0
    store.hiddenAppReleases = ['beta']
    const unchanged = await publisher.publish(memohDefinition, secondLock)
    expect(unchanged.skipped).toBe('unchanged')
    expect(store.appReleases).toEqual(['beta'])
    expect(store.artifacts).toBe(0)
    expect(store.images).toBe(0)
    store.hiddenAppReleases = []

    // A stored App release missing from the listing is re-uploaded (self-heal).
    store.appReleases = []
    store.artifacts = 0
    store.images = 0
    store.hiddenAppReleases = ['beta']
    await writeApp(projectRoot, 'alpha', 'Alpha version three', '<svg xmlns="http://www.w3.org/2000/svg"><title>alpha</title></svg>')
    const thirdLock = await releaseLock(projectRoot, memohDefinition)
    await publisher.publish(memohDefinition, thirdLock)
    expect(store.appReleases.sort()).toEqual(['alpha', 'beta'])
    expect(store.artifacts).toBe(1)
    expect(store.images).toBe(0)
    store.hiddenAppReleases = []

    // Stored Artifacts and images missing from the listing are re-uploaded too.
    store.appReleases = []
    store.artifacts = 0
    store.images = 0
    store.hideArtifacts = true
    store.hideImages = true
    await writeApp(projectRoot, 'alpha', 'Alpha version four', '<svg xmlns="http://www.w3.org/2000/svg"><title>alpha</title></svg>')
    const fourthLock = await releaseLock(projectRoot, memohDefinition)
    await publisher.publish(memohDefinition, fourthLock)
    expect(store.appReleases).toEqual(['alpha'])
    expect(store.artifacts).toBe(2)
    expect(store.images).toBe(2)
    store.hideArtifacts = false
    store.hideImages = false

    // A listing failure falls back to a full upload.
    store.appReleases = []
    store.artifacts = 0
    store.images = 0
    store.failListStoredRefs = true
    await writeApp(projectRoot, 'alpha', 'Alpha version five', '<svg xmlns="http://www.w3.org/2000/svg"><title>alpha</title></svg>')
    const fifthLock = await releaseLock(projectRoot, memohDefinition)
    await publisher.publish(memohDefinition, fifthLock)
    expect(store.appReleases.sort()).toEqual(['alpha', 'beta'])
    expect(store.artifacts).toBe(2)
    expect(store.images).toBe(2)
  })

  test('disabling a Registry hides it without deleting its approved Snapshot', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-disable-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-disable-data-'))
    roots.push(projectRoot, dataRoot)
    await writeSkill(projectRoot, 'Version one')
    const lock = await releaseLock(projectRoot)
    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)
    await publisher.publish(definition, lock)
    const approved = (await store.getState('memoh'))!.current_snapshot

    expect(await publisher.publish({ ...definition, enabled: false })).toEqual({
      registry: 'memoh',
      skipped: 'disabled',
    })
    expect(await store.getState('memoh')).toMatchObject({
      definition: { enabled: false },
      current_snapshot: approved,
    })
    expect(await store.getSnapshot('memoh', approved!)).not.toBeNull()

    expect(await publisher.publish(definition, lock)).toMatchObject({
      revision: approved,
      skipped: 'unchanged',
    })
    expect(await store.getState('memoh')).toMatchObject({
      definition: { enabled: true },
      current_snapshot: approved,
    })
  })

  test('rejects a rebuilt Snapshot that does not match its release lock', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-approval-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-approval-data-'))
    roots.push(projectRoot, dataRoot)
    await writeSkill(projectRoot, 'Candidate')
    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)

    const lock = await releaseLock(projectRoot)
    await expect(publisher.publish(definition, {
      ...lock,
      snapshot_revision: '0'.repeat(64),
    })).rejects.toThrow('release.lock.json locks Snapshot')
    expect(await store.getState('memoh')).toBeNull()
    expect(await readdir(dataRoot)).toEqual([])
  })

  test('publishes an approved prebuilt candidate without rebuilding its source', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-prebuilt-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-prebuilt-data-'))
    roots.push(projectRoot, dataRoot)
    await writeSkill(projectRoot, 'Approved content')
    const candidate = await buildSkillRegistryCandidate(definition, projectRoot)
    const lock = { snapshot_revision: candidate.revision }
    await writeFile(path.join(projectRoot, 'registries/memoh/skills/alpha/SKILL.md'), '# invalid')

    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)
    await expect(publisher.publish(definition, lock, candidate)).resolves.toMatchObject({
      revision: candidate.revision,
    })
    expect((await store.getState('memoh'))?.current_snapshot).toBe(candidate.revision)
  })

  test('requires a release lock before publishing an enabled Registry', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-git-approval-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-git-approval-data-'))
    roots.push(projectRoot, dataRoot)
    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)
    await expect(publisher.publish(definition)).rejects.toThrow('release.lock.json is required')
    expect(await readdir(dataRoot)).toEqual([])
  })

  test('rejects a Registry build that produces zero apps', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-empty-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-empty-data-'))
    roots.push(projectRoot, dataRoot)
    await mkdir(path.join(projectRoot, 'registries/memoh/skills'), { recursive: true })
    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)
    await expect(publisher.publish(definition, {
      snapshot_revision: '0'.repeat(64),
    })).rejects.toThrow('produced zero apps')
    expect(await store.getState('memoh')).toBeNull()
  })
})
