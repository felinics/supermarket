import type {
  CatalogSkill,
  RegistryDiagnostic,
  SkillArtifactDescriptor,
  SkillImageAsset,
  SkillRegistryDefinition,
  SkillRegistrySnapshot,
} from '../types'
import path from 'node:path'
import { buildSkillCandidates, skillAdapterBootstrapPaths } from '../adapters/index'
import { packageSkill } from '../artifacts/build'
import { sha256 } from '#lib/digest'
import { materializeSkillRegistrySource } from '../sources/index'
import {
  compactCatalogPackages,
  registrySnapshotRevision,
  serializeRegistrySnapshot,
} from '../snapshot'
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
  package_id: string
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
  | { type: 'scanned'; registry: string; skills: number; diagnostics: number }

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
  return `Skipped package: ${stable}`
}

export async function buildSkillRegistryCandidate(
  definition: SkillRegistryDefinition,
  projectRoot: string,
  options: SkillRegistryBuildOptions = {},
): Promise<SkillRegistryCandidate> {
  const onProgress = options.onProgress ?? (() => {})
  const budget = new RegistryBuildBudget()
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
    onProgress({
      type: 'scanned',
      registry: definition.id,
      skills: result.skills.length,
      diagnostics: result.diagnostics.length,
    })

    const skills: CatalogSkill[] = []
    const artifacts = new Map<string, CandidateArtifact>()
    const images = new Map<string, CandidateImage>()
    const review = new Map<string, CandidateSkillReview>()
    const diagnostics = [...result.diagnostics]
    const packages = new Map<string, typeof result.skills>()
    for (const candidate of result.skills) {
      const packageSkills = packages.get(candidate.package_id) ?? []
      packageSkills.push(candidate)
      packages.set(candidate.package_id, packageSkills)
    }
    for (const [packageID, candidates] of packages) {
      let packagedCandidates: Array<{
        candidate: (typeof candidates)[number]
        packaged: Awaited<ReturnType<typeof packageSkill>>
      }>
      try {
        packagedCandidates = []
        for (const candidate of candidates) {
          packagedCandidates.push({ candidate, packaged: await packageSkill(candidate.files) })
        }
      } catch (error) {
        rethrowRegistryBudgetError(error)
        diagnostics.push({
          package_id: packageID,
          code: 'package_invalid',
          message: artifactDiagnosticMessage(error, source.root),
        })
        continue
      }

      for (const { candidate, packaged } of packagedCandidates) {
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
          schema_version: '1',
          registry_id: definition.id,
          registry_priority: definition.priority,
          package_id: candidate.package_id,
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
              text: reviewText(file.bytes, `${candidate.package_id}/${candidate.skill_id}/${name}`, budget),
            }
          }
          review.set(`${candidate.package_id}/${candidate.skill_id}`, {
            package_id: candidate.package_id,
            skill_id: candidate.skill_id,
            files,
          })
        }
      }
    }

    skills.sort((a, b) => compareCanonicalText(a.name, b.name)
      || compareCanonicalText(a.package_id, b.package_id)
      || compareCanonicalText(a.skill_id, b.skill_id))
    if (!skills.length) {
      throw new Error(`${definition.id}: Registry build produced zero skills`)
    }
    diagnostics.sort((a, b) => compareCanonicalText(a.package_id ?? '', b.package_id ?? '')
      || compareCanonicalText(a.code, b.code))
    const snapshot: SkillRegistrySnapshot = {
      schema_version: '1',
      registry_id: definition.id,
      registry_priority: definition.priority,
      source: {
        type: definition.source.type,
        revision: source.revision,
        ...(definition.source.type === 'git' ? { repository: definition.source.url } : {}),
      },
      packages: compactCatalogPackages(skills, result.packageMetadata),
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
