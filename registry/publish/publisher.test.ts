import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseGzipTarArchive } from '../../client/archive'
import type { SkillRegistryDefinition } from '../types'
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

async function writeSkill(projectRoot: string, description: string) {
  const directory = path.join(projectRoot, 'registries/memoh/skills/alpha')
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: Alpha\ndescription: ${description}\n---\n\n# Alpha\n`,
  )
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
      'source', 'source_ready', 'scanned', 'skill', 'publishing',
    ])
    const firstState = await store.getState('memoh')
    const firstSnapshot = await store.getSnapshot('memoh', firstState!.current_snapshot!)
    expect(firstSnapshot!.packages[0]!.skills[0]!.artifact.size).toBeGreaterThan(0)
    const artifact = await store.getArtifact(firstSnapshot!.packages[0]!.skills[0]!.artifact.digest)
    expect((await parseGzipTarArchive(artifact!.bytes)).has('SKILL.md')).toBe(true)

    expect(await publisher.publish(definition, lock)).toMatchObject({
      revision: first.revision,
      skipped: 'unchanged',
    })

    await writeFile(path.join(projectRoot, 'registries/memoh/skills/alpha/SKILL.md'), '# invalid')
    await expect(publisher.publish(definition, lock)).rejects.toThrow('frontmatter')
    expect((await store.getState('memoh'))?.current_snapshot).toBe(firstState?.current_snapshot)
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

  test('rejects a Registry build that produces zero skills', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-empty-project-'))
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'registry-empty-data-'))
    roots.push(projectRoot, dataRoot)
    await mkdir(path.join(projectRoot, 'registries/memoh/skills'), { recursive: true })
    const store = new LocalSkillRegistryStore(dataRoot)
    const publisher = new SkillRegistryPublisher(store, projectRoot)
    await expect(publisher.publish(definition, {
      snapshot_revision: '0'.repeat(64),
    })).rejects.toThrow('produced zero skills')
    expect(await store.getState('memoh')).toBeNull()
  })
})
