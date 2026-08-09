import {
  MAX_SKILL_ARTIFACT_COMPRESSED_BYTES,
} from '../types'
import { createTar, gzip } from '#lib/archive'
import { sha256 } from '#lib/digest'
import type { SkillSourceFile } from '../filesystem'

export async function packageSkill(files: Record<string, SkillSourceFile>) {
  // Artifact bytes describe only the Skill content. The Catalog's install_id
  // selects the destination namespace and must not influence the content hash.
  const archive = await createTar(files, '')
  const bytes = await gzip(archive)
  if (bytes.length > MAX_SKILL_ARTIFACT_COMPRESSED_BYTES) {
    throw new Error(`Compressed Skill Artifact exceeds ${MAX_SKILL_ARTIFACT_COMPRESSED_BYTES} bytes`)
  }
  const uncompressedSize = Object.values(files)
    .reduce((total, file) => total + file.bytes.length, 0)
  return {
    bytes,
    digest: await sha256(bytes),
    uncompressedSize,
    archiveSize: archive.length,
    fileCount: Object.keys(files).length,
  }
}
