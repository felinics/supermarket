import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SkillRegistryDefinition } from '#registry/types'
import { SkillRegistryPublisher, type SkillRegistryPublishProgress } from '#registry/publish/publisher'
import { buildSkillRegistryCandidate, type SkillRegistryCandidate } from '#registry/publish/candidate'
import { assertReleaseCandidate, loadRegistryReleaseLock } from '#registry/publish/release-lock'
import type { RegistryReleaseLock } from '#registry/publish/release-lock'
import { loadSkillRegistryDefinitionResults } from '#registry/definitions/repository'
import { BlobSkillRegistryStore } from '#registry/storage/blob'
import type { SkillRegistryStore } from '#registry/storage/contracts'
import { LocalSkillRegistryStore } from '#registry/storage/local'
import { S3BlobBackend } from '#registry/storage/s3'

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

async function createStore(projectRoot: string, environment?: DeploymentEnvironment): Promise<SkillRegistryStore> {
  const dataRoot = path.join(projectRoot, '.data/registries')
  if (!environment) return new LocalSkillRegistryStore(dataRoot)
  const options = {
    accountID: requiredEnvironment('CLOUDFLARE_ACCOUNT_ID'),
    accessKeyID: requiredEnvironment('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnvironment('R2_SECRET_ACCESS_KEY'),
    bucket: await bucketForEnvironment(projectRoot, environment),
  }
  return new BlobSkillRegistryStore(new S3BlobBackend(options))
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

if (import.meta.main) {
  const projectRoot = path.resolve(import.meta.dirname, '../..')
  const registryID = option('--registry')
  const rawEnvironment = option('--environment')
  if (rawEnvironment && rawEnvironment !== 'test' && rawEnvironment !== 'production') {
    throw new Error('--environment must be test or production')
  }
  const environment = rawEnvironment as DeploymentEnvironment | undefined
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

  const store = await createStore(projectRoot, environment)
  const locks = new Map<string, RegistryReleaseLock>()
  for (const definition of definitions) {
    if (!definition.enabled) continue
    locks.set(definition.id, await loadRegistryReleaseLock(projectRoot, definition))
  }
  let prebuiltCandidate: SkillRegistryCandidate | undefined
  if (registryID && definitions.length) {
    prebuiltCandidate = await preflightPartialPublication({
      projectRoot,
      definition: definitions[0]!,
    })
  }
  const outcome = await publishSkillRegistries({
    definitions,
    store,
    publisher: new SkillRegistryPublisher(store, projectRoot, createSkillRegistryProgressRenderer()),
    locks,
    candidates: prebuiltCandidate
      ? new Map([[prebuiltCandidate.definition.id, prebuiltCandidate]])
      : undefined,
    knownRegistryIDs: [
      ...loaded.definitions.map((definition) => definition.id),
      ...loaded.failures.map((failure) => failure.registry),
    ],
  })
  for (const result of outcome.results) console.log(result)
  const failures: Array<{ registry: string; error: unknown }> = [
    ...definitionFailures.map((failure) => ({ registry: failure.registry, error: failure.error })),
    ...outcome.failures,
  ]
  for (const failure of failures) {
    console.error({
      registry: failure.registry,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    })
  }
  if (failures.length) process.exitCode = 1
}
