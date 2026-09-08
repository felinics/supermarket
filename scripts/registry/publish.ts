import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SkillRegistryDefinition } from '#registry/types'
import { SkillRegistryPublisher, type SkillRegistryPublishProgress, type SkillRegistryPublishResult } from '#registry/publish/publisher'
import { buildSkillRegistryCandidate, type SkillRegistryCandidate } from '#registry/publish/candidate'
import { assertReleaseCandidate, loadRegistryReleaseLock } from '#registry/publish/release-lock'
import type { RegistryReleaseLock } from '#registry/publish/release-lock'
import { loadSkillRegistryDefinitionResults } from '#registry/definitions/repository'
import { BlobSkillRegistryStore } from '#registry/storage/blob'
import type { SkillRegistryStore } from '#registry/storage/contracts'
import { LocalBlobBackend } from '#registry/storage/local'
import { S3BlobBackend } from '#registry/storage/s3'
import { DependencyRegistryStore } from '#registry/dependencies/store'
import { approvedDependencies } from '#registry/dependencies/release-lock'

type DeploymentEnvironment = 'test' | 'production'

interface ApiWranglerConfig {
  env?: Record<string, {
    r2_buckets?: Array<{ binding?: string; bucket_name?: string }>
  }>
}

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function createSkillRegistryProgressRenderer(
  write: (text: string) => void = (text) => process.stderr.write(text),
  interactive = process.stderr.isTTY === true,
) {
  let openLine = false
  const line = (text: string) => {
    if (openLine) {
      write('\n')
      openLine = false
    }
    write(`${text}\n`)
  }
  return (progress: SkillRegistryPublishProgress) => {
    switch (progress.type) {
      case 'source':
        line(`${progress.registry}: fetching approved source`)
        break
      case 'source_ready':
        line(`${progress.registry}: source revision ${progress.revision.slice(0, 12)}`)
        break
      case 'scanned':
        line(`${progress.registry}: packaging ${progress.skills} Skills (${progress.diagnostics} diagnostics)`)
        break
      case 'skill': {
        const text = `${progress.registry}: [${progress.index}/${progress.total}] ${progress.package_id}/${progress.skill_id}${progress.uploaded ? ' (uploaded)' : ''}`
        if (interactive) {
          write(`\r\u001B[2K${text}`)
          openLine = progress.index !== progress.total
          if (!openLine) write('\n')
        } else if (progress.uploaded || progress.index % 25 === 0 || progress.index === progress.total) {
          line(text)
        }
        break
      }
      case 'publishing':
        line(`${progress.registry}: publishing Snapshot ${progress.revision.slice(0, 12)}`)
        break
    }
  }
}

async function bucketForEnvironment(projectRoot: string, environment: DeploymentEnvironment) {
  const configPath = path.join(projectRoot, 'workers/api/wrangler.jsonc')
  const config = Bun.JSONC.parse(await readFile(configPath, 'utf8')) as ApiWranglerConfig
  const bucket = config.env?.[environment]?.r2_buckets
    ?.find((item) => item.binding === 'SKILL_REGISTRY_BUCKET')
    ?.bucket_name
  if (!bucket) throw new Error(`API Worker ${environment} environment is missing SKILL_REGISTRY_BUCKET`)
  return bucket
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for remote Registry publication`)
  return value
}

async function createStores(projectRoot: string, environment?: DeploymentEnvironment) {
  const dataRoot = process.env.REGISTRY_DATA_DIR || path.join(projectRoot, '.data/registries')
  if (!environment) {
    const backend = new LocalBlobBackend(dataRoot)
    return { skills: new BlobSkillRegistryStore(backend), dependencies: new DependencyRegistryStore(backend) }
  }
  const options = {
    accountID: requiredEnvironment('CLOUDFLARE_ACCOUNT_ID'),
    accessKeyID: requiredEnvironment('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnvironment('R2_SECRET_ACCESS_KEY'),
    bucket: await bucketForEnvironment(projectRoot, environment),
  }
  const backend = new S3BlobBackend(options)
  return { skills: new BlobSkillRegistryStore(backend), dependencies: new DependencyRegistryStore(backend) }
}

export async function publishSkillRegistries(input: {
  definitions: SkillRegistryDefinition[]
  store: SkillRegistryStore
  publisher: {
    publish(
      definition: SkillRegistryDefinition,
      lock?: RegistryReleaseLock,
      candidate?: SkillRegistryCandidate,
    ): ReturnType<SkillRegistryPublisher['publish']>
  }
  locks?: ReadonlyMap<string, RegistryReleaseLock>
  candidates?: ReadonlyMap<string, SkillRegistryCandidate>
  knownRegistryIDs?: Iterable<string>
}) {
  const results = []
  const failures: Array<{ registry: string; error: unknown }> = []
  for (const definition of input.definitions) {
    try {
      results.push(await input.publisher.publish(
        definition,
        input.locks?.get(definition.id),
        input.candidates?.get(definition.id),
      ))
    } catch (error) {
      failures.push({ registry: definition.id, error })
    }
  }

  const known = new Set(input.knownRegistryIDs ?? input.definitions.map((item) => item.id))
  for (const registryID of await input.store.listRegistryIDs()) {
    if (known.has(registryID)) continue
    try {
      const state = await input.store.getState(registryID)
      if (!state?.definition.enabled) continue
      results.push(await input.publisher.publish({ ...state.definition, enabled: false }))
    } catch (error) {
      failures.push({ registry: registryID, error })
    }
  }
  return { results, failures }
}

async function preflightPartialPublication(input: {
  projectRoot: string
  definition: SkillRegistryDefinition
}) {
  if (!input.definition.enabled) return undefined
  const [candidate, lock] = await Promise.all([
    buildSkillRegistryCandidate(input.definition, input.projectRoot),
    loadRegistryReleaseLock(input.projectRoot, input.definition),
  ])
  assertReleaseCandidate(input.definition, lock, candidate.revision)
  return candidate
}

export async function publishRegistries(input: {
  projectRoot: string
  registryID?: string
  kind?: 'all' | 'skills' | 'dependencies'
  stores: { skills: SkillRegistryStore; dependencies: DependencyRegistryStore }
  onProgress?: (progress: SkillRegistryPublishProgress) => void
}) {
  const { projectRoot, registryID, kind = 'all', stores } = input
  const loaded = await loadSkillRegistryDefinitionResults(projectRoot)
  const definitions = registryID
    ? loaded.definitions.filter((definition) => definition.id === registryID)
    : loaded.definitions
  const definitionFailures = registryID
    ? loaded.failures.filter((failure) => failure.registry === registryID)
    : loaded.failures
  if (registryID && !definitions.length && !definitionFailures.length) {
    throw new Error(`Registry not found: ${registryID}`)
  }

  const store = stores.skills
  // Complete lock validation and scoped source preflight before publishing
  // either resource kind. Each kind still has its own publication pointer.
  const locks = new Map<string, RegistryReleaseLock>()
  if (kind !== 'dependencies') {
    for (const definition of definitions) {
      if (!definition.enabled) continue
      locks.set(definition.id, await loadRegistryReleaseLock(projectRoot, definition))
    }
  }
  let prebuiltCandidate: SkillRegistryCandidate | undefined
  if (kind !== 'dependencies' && registryID && definitions.length) {
    prebuiltCandidate = await preflightPartialPublication({
      projectRoot,
      definition: definitions[0]!,
    })
  }
  const dependencyCandidate = kind !== 'skills' && (!registryID || registryID === 'memoh')
    ? await approvedDependencies(projectRoot) : undefined
  const results: Array<SkillRegistryPublishResult | {
    registry: string; kind: 'dependencies'; revision: string; dependencies: number
  }> = []
  if (dependencyCandidate) {
    const official = loaded.definitions.find((item) => item.id === 'memoh')
    if (!official) throw new Error('Official memoh Registry definition is missing')
    await stores.dependencies.publish(dependencyCandidate, official.enabled)
    results.push({ registry: 'memoh', kind: 'dependencies', revision: dependencyCandidate.revision, dependencies: dependencyCandidate.releases.length })
  }
  if (kind === 'dependencies') {
    if (!dependencyCandidate) throw new Error('Only the memoh dependency registry is supported')
    return { results, failures: [] }
  }
  const outcome = await publishSkillRegistries({
    definitions,
    store,
    publisher: new SkillRegistryPublisher(store, projectRoot, input.onProgress),
    locks,
    candidates: prebuiltCandidate
      ? new Map([[prebuiltCandidate.definition.id, prebuiltCandidate]])
      : undefined,
    knownRegistryIDs: [
      ...loaded.definitions.map((definition) => definition.id),
      ...loaded.failures.map((failure) => failure.registry),
    ],
  })
  results.push(...outcome.results)
  const failures: Array<{ registry: string; error: unknown }> = [
    ...definitionFailures.map((failure) => ({ registry: failure.registry, error: failure.error })),
    ...outcome.failures,
  ]
  return { results, failures }
}

if (import.meta.main) {
  const projectRoot = path.resolve(import.meta.dirname, '../..')
  const registryID = option('--registry')
  const kind = option('--kind') ?? 'all'
  if (kind !== 'all' && kind !== 'skills' && kind !== 'dependencies') throw new Error('--kind must be all, skills, or dependencies')
  const rawEnvironment = option('--environment')
  if (rawEnvironment && rawEnvironment !== 'test' && rawEnvironment !== 'production') {
    throw new Error('--environment must be test or production')
  }
  const environment = rawEnvironment as DeploymentEnvironment | undefined
  const outcome = await publishRegistries({
    projectRoot, registryID, kind,
    stores: await createStores(projectRoot, environment),
    onProgress: createSkillRegistryProgressRenderer(),
  })
  for (const result of outcome.results) console.log(result)
  for (const failure of outcome.failures) {
    console.error({
      registry: failure.registry,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    })
  }
  if (outcome.failures.length) process.exitCode = 1
}
