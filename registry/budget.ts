import { canonicalArchivePath } from '#lib/archive'

export const MAX_REGISTRY_SKILLS = 10_000
export const MAX_REGISTRY_SOURCE_FILES = 100_000
export const MAX_REGISTRY_SOURCE_BYTES = 512 * 1024 * 1024
export const MAX_REGISTRY_REVIEW_TEXT_BYTES = 64 * 1024 * 1024
export const MAX_REGISTRY_METADATA_FILE_BYTES = 8 * 1024 * 1024
export const MAX_REGISTRY_SNAPSHOT_BYTES = 8 * 1024 * 1024
export const MAX_REGISTRY_PACKAGE_SKILLS = 128
export const MAX_REGISTRY_PACKAGE_RELEASE_BYTES = 8 * 1024 * 1024
export const MAX_REGISTRY_PACKAGE_ARTIFACT_COMPRESSED_BYTES = 128 * 1024 * 1024
export const MAX_REGISTRY_PACKAGE_ARTIFACT_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
export const MAX_REGISTRY_PACKAGE_ARTIFACT_ARCHIVE_BYTES = 128 * 1024 * 1024
export const MAX_REGISTRY_PACKAGE_ARTIFACT_FILES = 10_000

export interface RegistryBuildBudgetLimits {
  skills: number
  sourceFiles: number
  sourceBytes: number
  reviewTextBytes: number
}

export const registryBuildBudgetLimits: RegistryBuildBudgetLimits = {
  skills: MAX_REGISTRY_SKILLS,
  sourceFiles: MAX_REGISTRY_SOURCE_FILES,
  sourceBytes: MAX_REGISTRY_SOURCE_BYTES,
  reviewTextBytes: MAX_REGISTRY_REVIEW_TEXT_BYTES,
}

export class RegistryBudgetExceededError extends Error {}

export class RegistryBuildBudget {
  private skillCount = 0
  private sourceBytes = 0
  private reviewTextBytes = 0
  private readonly sourceFiles = new Map<string, { path: string; size: number }>()

  constructor(private readonly limits: RegistryBuildBudgetLimits = registryBuildBudgetLimits) {}

  assertSkillEntries(count: number, label: string) {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.limits.skills) {
      throw new RegistryBudgetExceededError(`${label} exceeds ${this.limits.skills} entries`)
    }
  }

  addSkill(identity: string) {
    if (this.skillCount >= this.limits.skills) {
      throw new RegistryBudgetExceededError(`Registry exceeds ${this.limits.skills} Skills while adding ${identity}`)
    }
    this.skillCount++
  }

  addSourceFile(sourcePath: string, size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid Registry source file size: ${sourcePath}`)
    const key = canonicalArchivePath(sourcePath)
    const previous = this.sourceFiles.get(key)
    if (previous) {
      if (previous.path !== sourcePath) {
        throw new Error(`Duplicate Registry source path: ${sourcePath} conflicts with ${previous.path}`)
      }
      if (previous.size !== size) throw new Error(`Registry source file changed size: ${sourcePath}`)
      return
    }
    if (this.sourceFiles.size >= this.limits.sourceFiles) {
      throw new RegistryBudgetExceededError(`Registry source exceeds ${this.limits.sourceFiles} files`)
    }
    if (size > this.limits.sourceBytes - this.sourceBytes) {
      throw new RegistryBudgetExceededError(`Registry source exceeds ${this.limits.sourceBytes} bytes`)
    }
    this.sourceFiles.set(key, { path: sourcePath, size })
    this.sourceBytes += size
  }

  addReviewText(sourcePath: string, size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid Registry review text size: ${sourcePath}`)
    if (size > this.limits.reviewTextBytes - this.reviewTextBytes) {
      throw new RegistryBudgetExceededError(`Registry review text exceeds ${this.limits.reviewTextBytes} bytes`)
    }
    this.reviewTextBytes += size
  }
}

export function rethrowRegistryBudgetError(error: unknown): void {
  if (error instanceof RegistryBudgetExceededError) throw error
}
