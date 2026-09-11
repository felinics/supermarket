import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { SkillImageAsset, SkillImageContentType } from '../types'
import { MAX_SKILL_IMAGE_BYTES } from '../types'
import { safeRelativePath } from '../definition'
import { readFileBounded, resolveRealInside } from '../filesystem'
import { sha256 } from '#lib/digest'
import type { RegistryBuildBudget } from '../budget'

export const imageTypes: Record<string, SkillImageContentType> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export function detectSkillImageContentType(bytes: Uint8Array): SkillImageContentType | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      .replace(/^\uFEFF/, '')
      .trimStart()
    if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)) {
      return 'image/svg+xml'
    }
  } catch {
    // Binary data is not SVG.
  }
  return undefined
}

export function declaredImagePath(value: unknown, field: string) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a relative image path`)
  const relativePath = safeRelativePath(value, field)
  if (!imageTypes[path.extname(relativePath).toLowerCase()]) throw new Error(`${field} uses an unsupported image type`)
  return relativePath
}

export class OversizedSkillImageError extends Error {}

export async function readImageAsset(
  appRoot: string,
  relativePath: string,
  budget: RegistryBuildBudget,
) {
  const target = await resolveRealInside(appRoot, relativePath)
  const metadata = await stat(target)
  if (!metadata.isFile()) throw new Error(`Skill image ${relativePath} must be a regular file`)
  if (metadata.size > MAX_SKILL_IMAGE_BYTES) throw new OversizedSkillImageError(relativePath)
  const bytes = await readFileBounded(
    target,
    MAX_SKILL_IMAGE_BYTES,
    budget,
  )
  if (!bytes.length || bytes.length > MAX_SKILL_IMAGE_BYTES) {
    throw new Error(`Skill image ${relativePath} must be between 1 and ${MAX_SKILL_IMAGE_BYTES} bytes`)
  }
  const contentType = detectSkillImageContentType(bytes)
  const declaredType = imageTypes[path.extname(relativePath).toLowerCase()]!
  if (!contentType || contentType !== declaredType) {
    throw new Error(`Skill image ${relativePath} content does not match its file extension`)
  }
  const descriptor: SkillImageAsset = {
    digest: await sha256(bytes),
    size: bytes.length,
    content_type: contentType,
  }
  return { descriptor, bytes }
}
