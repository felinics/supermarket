import type {
  CatalogSkill,
  RegistryDiagnostic,
  SkillArtifactDescriptor,
  SkillImageAsset,
  SkillRegistryDefinition,
  SkillRegistrySnapshot,
} from '../types'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { buildSkillCandidates, skillAdapterBootstrapPaths } from '../adapters/index'
import type { SkillAdapterResult, SkillCandidate } from '../adapters/types'
import { packageSkill } from '../artifacts/build'
import { sha256 } from '#lib/digest'
import { materializeSkillRegistrySource } from '../sources/index'
import {
  compactCatalogApps,
  registrySnapshotRevision,
  serializeRegistrySnapshot,
  snapshotCategoriesFor,
} from '../snapshot'
import { CategoryTable, loadCategoryTable } from '../categories'
import { DEPENDENCY_REGISTRY } from '../dependencies/types'
import { compareCanonicalText } from '#lib/order'
import {
  MAX_REGISTRY_SNAPSHOT_BYTES,
  RegistryBuildBudget,
  rethrowRegistryBudgetError,
} from '../budget'

const maxReviewTextBytes = 64 * 1024

export interface CandidateFile {
  digest: string
  size: number
  mode: number
  text?: string
}

export interface CandidateSkillReview {
  app_id: string
  skill_id: string
  files: Record<string, CandidateFile>
}

export interface CandidateArtifact {
  descriptor: SkillArtifactDescriptor
  bytes: Uint8Array
}

export interface CandidateImage {
  descriptor: SkillImageAsset
  bytes: Uint8Array
}

export interface SkillRegistryCandidate {
  definition: SkillRegistryDefinition
  source_revision: string
  revision: string
  snapshot: SkillRegistrySnapshot
  snapshotBytes: Uint8Array
  skills: CatalogSkill[]
  diagnostics: RegistryDiagnostic[]
  artifacts: Map<string, CandidateArtifact>
  images: Map<string, CandidateImage>
  review: Map<string, CandidateSkillReview>
}

export type SkillRegistryBuildProgress =
  | { type: 'source'; registry: string }
  | { type: 'source_ready'; registry: string; revision: string }
  | { type: 'scanned'; registry: string; skills: number; apps: number; diagnostics: number }

export interface SkillRegistryBuildOptions {
  includeReview?: boolean
  onProgress?: (progress: SkillRegistryBuildProgress) => void
}

function reviewText(bytes: Uint8Array, sourcePath: string, budget: RegistryBuildBudget) {
  if (bytes.length > maxReviewTextBytes) return undefined
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  budget.addReviewText(sourcePath, bytes.length)
  return text
}

function artifactDiagnosticMessage(error: unknown, sourceRoot: string) {
  const message = error instanceof Error ? error.message : String(error)
  const root = path.resolve(sourceRoot)
  const stable = [root, root.replaceAll(path.sep, '/'), root.replaceAll(path.sep, '\\')]
    .reduce((value, prefix) => value.replaceAll(prefix, '<source>'), message)
  return `Skipped app: ${stable}`
}

/** IDs of the workspace dependency definitions published next to the official Apps. */
export async function listDependencyIDs(projectRoot: string): Promise<Set<string>> {
  const root = path.join(projectRoot, 'registries', DEPENDENCY_REGISTRY, 'dependencies')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

/**
 * Cross-resource rules that adapters cannot check on their own: reviewed
 * categories must exist, dependency and connector references are limited to
 * the official registry, and referenced dependencies must be published. Shared
 * implementation dependencies do not require separate user-facing Apps.
 */
export function validateAppCandidates(
  definition: SkillRegistryDefinition,
  result: Pick<SkillAdapterResult, 'apps'>,
  categories: CategoryTable,
  dependencyIDs: ReadonlySet<string>,
) {
  const official = definition.id === DEPENDENCY_REGISTRY
  for (const candidate of result.apps.values()) {
    const label = `${definition.id}/${candidate.app_id}`
    if (candidate.reviewed && candidate.category) categories.require(candidate.category, label)
    if ((candidate.dependencies.length || candidate.connectors.length) && !official) {
      throw new Error(`${label}: dependencies and connectors are only supported in the ${DEPENDENCY_REGISTRY} registry`)
    }
    for (const dependency of candidate.dependencies) {
      if (!dependencyIDs.has(dependency)) throw new Error(`${label}: unknown dependency "${dependency}"`)
    }
  }
}

/** Maps Skill categories onto the shared table when an alias matches; unknown values are kept. */
export function applyCategoryTable(skills: SkillCandidate[], categories: CategoryTable) {
  for (const skill of skills) {
    const resolved = categories.lookup(skill.source_category ?? skill.category)
    if (!resolved) continue
    skill.category = resolved.id
    skill.category_name = resolved.name.en
  }
}

export async function buildSkillRegistryCandidate(
  definition: SkillRegistryDefinition,
  projectRoot: string,
  options: SkillRegistryBuildOptions = {},
): Promise<SkillRegistryCandidate> {
  const onProgress = options.onProgress ?? (() => {})
  const budget = new RegistryBuildBudget()
  const [categories, dependencyIDs] = await Promise.all([
    loadCategoryTable(projectRoot),
    listDependencyIDs(projectRoot),
  ])
  onProgress({ type: 'source', registry: definition.id })
  const source = await materializeSkillRegistrySource(
    definition,
    projectRoot,
    skillAdapterBootstrapPaths(definition),
  )
  try {
    onProgress({ type: 'source_ready', registry: definition.id, revision: source.revision })
    const result = await buildSkillCandidates({
      definition: source.definition,
      sourceRoot: source.root,
      ensurePaths: source.ensurePaths,
      budget,
    })
    validateAppCandidates(definition, result, categories, dependencyIDs)
    applyCategoryTable(result.skills, categories)
    onProgress({
      type: 'scanned',
      registry: definition.id,
      skills: result.skills.length,
      apps: new Set([...result.apps.keys(), ...result.skills.map((skill) => skill.app_id)]).size,
      diagnostics: result.diagnostics.length,
    })

    const skills: CatalogSkill[] = []
    const artifacts = new Map<string, CandidateArtifact>()
    const images = new Map<string, CandidateImage>()
    const review = new Map<string, CandidateSkillReview>()
    const diagnostics = [...result.diagnostics]
    const apps = new Map<string, typeof result.skills>()
    for (const candidate of result.skills) {
      const appSkills = apps.get(candidate.app_id) ?? []
      appSkills.push(candidate)
      apps.set(candidate.app_id, appSkills)
    }
    const skippedApps = new Set<string>()
    for (const [appID, candidates] of apps) {
      let appdCandidates: Array<{
        candidate: (typeof candidates)[number]
        packaged: Awaited<ReturnType<typeof packageSkill>>
      }>
      try {
        appdCandidates = []
        for (const candidate of candidates) {
          appdCandidates.push({ candidate, packaged: await packageSkill(candidate.files) })
        }
      } catch (error) {
        rethrowRegistryBudgetError(error)
        diagnostics.push({
          app_id: appID,
          code: 'app_invalid',
          message: artifactDiagnosticMessage(error, source.root),
        })
        skippedApps.add(appID)
        continue
      }

      for (const { candidate, packaged } of appdCandidates) {
        const descriptor: SkillArtifactDescriptor = {
          format: 'memoh_skill_v1',
          digest: packaged.digest,
          size: packaged.bytes.length,
          uncompressed_size: packaged.uncompressedSize,
          archive_size: packaged.archiveSize,
          file_count: packaged.fileCount,
          content_type: 'application/gzip',
        }
        artifacts.set(descriptor.digest, { descriptor, bytes: packaged.bytes })
        for (const image of candidate.icon_assets ?? []) {
          images.set(image.descriptor.digest, image)
        }
        const sourcePath = [definition.source.path, candidate.source_path].filter(Boolean).join('/')
        const skill: CatalogSkill = {
          schema_version: '2',
          registry_id: definition.id,
          registry_priority: definition.priority,
          app_id: candidate.app_id,
          skill_id: candidate.skill_id,
          install_id: candidate.install_id,
          name: candidate.name,
          description: candidate.description,
          author: candidate.author,
          homepage: candidate.homepage,
          tags: candidate.tags,
          category: candidate.category,
          category_name: candidate.category_name,
          source_category: candidate.source_category,
          source: {
            type: definition.source.type,
            revision: source.revision,
            path: sourcePath,
            repository: definition.source.type === 'git' ? definition.source.url : undefined,
          },
          files: Object.keys(candidate.files).sort(),
          icon: candidate.icon,
          artifact: descriptor,
        }
        skills.push(skill)
        if (options.includeReview) {
          const files: Record<string, CandidateFile> = Object.create(null) as Record<string, CandidateFile>
          for (const [name, file] of Object.entries(candidate.files)
            .sort(([left], [right]) => compareCanonicalText(left, right))) {
            files[name] = {
              digest: await sha256(file.bytes),
              size: file.bytes.length,
              mode: file.mode,
              text: reviewText(file.bytes, `${candidate.app_id}/${candidate.skill_id}/${name}`, budget),
            }
          }
          review.set(`${candidate.app_id}/${candidate.skill_id}`, {
            app_id: candidate.app_id,
            skill_id: candidate.skill_id,
            files,
          })
        }
      }
    }
    const appCandidates = new Map(
      [...result.apps].filter(([appID]) => !skippedApps.has(appID)),
    )
    for (const candidate of appCandidates.values()) {
      for (const image of candidate.icon_assets ?? []) images.set(image.descriptor.digest, image)
    }

    skills.sort((a, b) => compareCanonicalText(a.name, b.name)
      || compareCanonicalText(a.app_id, b.app_id)
      || compareCanonicalText(a.skill_id, b.skill_id))
    diagnostics.sort((a, b) => compareCanonicalText(a.app_id ?? '', b.app_id ?? '')
      || compareCanonicalText(a.code, b.code))
    const snapshotApps = compactCatalogApps(skills, {
      registry: definition.id,
      apps: appCandidates,
      categories,
    })
    if (!snapshotApps.length) {
      throw new Error(`${definition.id}: Registry build produced zero apps`)
    }
    const snapshot: SkillRegistrySnapshot = {
      schema_version: '2',
      registry_id: definition.id,
      registry_priority: definition.priority,
      source: {
        type: definition.source.type,
        revision: source.revision,
        ...(definition.source.type === 'git' ? { repository: definition.source.url } : {}),
      },
      categories: snapshotCategoriesFor(snapshotApps, categories),
      apps: snapshotApps,
      diagnostics,
    }
    const snapshotBytes = serializeRegistrySnapshot(snapshot)
    if (snapshotBytes.length > MAX_REGISTRY_SNAPSHOT_BYTES) {
      throw new Error(`${definition.id}: Registry Snapshot exceeds ${MAX_REGISTRY_SNAPSHOT_BYTES} bytes`)
    }
    return {
      definition: source.definition,
      source_revision: source.revision,
      revision: registrySnapshotRevision(snapshotBytes),
      snapshot,
      snapshotBytes,
      skills,
      diagnostics,
      artifacts,
      images,
      review,
    }
  } finally {
    await source.cleanup()
  }
}
