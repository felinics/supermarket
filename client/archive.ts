import { chmod, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createGzipDecoder, createTarDecoder, type ParsedTarEntry } from 'modern-tar'
import {
  assertSafeArchivePath,
  assertSafeArchivePaths,
} from '#lib/archive'
import {
  MAX_SKILL_ARTIFACT_FILES,
  MAX_SKILL_ARTIFACT_UNCOMPRESSED_BYTES,
} from '#registry/types'

export interface ArchiveFile {
  bytes: Uint8Array
  mode: 0o644 | 0o755
}

async function readEntry(entry: ParsedTarEntry, remainingBytes: number) {
  if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.header.size > remainingBytes) {
    await entry.body.cancel()
    throw new Error('Archive exceeds extraction limits')
  }
  const reader = entry.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > entry.header.size || total > remainingBytes) {
        await reader.cancel()
        throw new Error('Archive exceeds extraction limits')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total !== entry.header.size) throw new Error(`Truncated archive entry: ${entry.header.name}`)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function limitStream(limit: number, message: string) {
  let total = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length
      if (total > limit) throw new Error(message)
      controller.enqueue(chunk)
    },
  })
}

async function parseTarStream(input: ReadableStream<Uint8Array>): Promise<Map<string, ArchiveFile>> {
  const entries = input.pipeThrough(createTarDecoder({ strict: true }))
  const files = new Map<string, ArchiveFile>()
  let totalBytes = 0

  for await (const entry of entries) {
    const name = assertSafeArchivePath(entry.header.name, 'archive')
    if (entry.header.type !== 'file') {
      await entry.body.cancel()
      throw new Error(`Unsupported archive entry type for ${name}`)
    }
    if (files.has(name)) {
      await entry.body.cancel()
      throw new Error(`Duplicate archive entry: ${name}`)
    }
    if (files.size >= MAX_SKILL_ARTIFACT_FILES) {
      await entry.body.cancel()
      throw new Error('Archive exceeds extraction limits')
    }
    const data = await readEntry(entry, MAX_SKILL_ARTIFACT_UNCOMPRESSED_BYTES - totalBytes)
    totalBytes += data.length
    files.set(name, { bytes: data, mode: (entry.header.mode ?? 0) & 0o111 ? 0o755 : 0o644 })
  }

  if (!files.size) throw new Error('Archive contains no files')
  assertSafeArchivePaths(files.keys(), 'archive')
  return files
}

function byteStream(bytes: Uint8Array) {
  return new Blob([bytes.slice().buffer as ArrayBuffer]).stream()
}

export function parseTarArchive(bytes: Uint8Array) {
  return parseTarStream(byteStream(bytes).pipeThrough(
    limitStream(MAX_SKILL_ARTIFACT_UNCOMPRESSED_BYTES, 'Archive exceeds extraction limits'),
  ))
}

export function parseGzipTarArchive(bytes: Uint8Array, limit = MAX_SKILL_ARTIFACT_UNCOMPRESSED_BYTES) {
  return parseTarStream(byteStream(bytes)
    .pipeThrough(createGzipDecoder())
    .pipeThrough(limitStream(limit, 'Archive exceeds decompression limit')))
}

export function validateSkillArchive(files: Map<string, ArchiveFile>) {
  assertSafeArchivePaths(files.keys(), 'Skill archive')
  if (!files.has('SKILL.md')) throw new Error('Skill archive does not contain SKILL.md at its root')
}

export async function extractSkillArchive(files: Map<string, ArchiveFile>, destination: string, installID: string) {
  validateSkillArchive(files)
  const destinationRoot = path.resolve(destination)
  const root = path.resolve(destinationRoot, installID)
  if (!installID || path.isAbsolute(installID)
    || root === destinationRoot || !root.startsWith(`${destinationRoot}${path.sep}`)) {
    throw new Error(`Install identity escapes destination: ${installID}`)
  }
  await mkdir(path.dirname(root), { recursive: true })
  try {
    await lstat(root)
    throw new Error(`Install destination already exists: ${root}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = `${root}.tmp-${crypto.randomUUID()}`
  let claimedRoot = false
  try {
    for (const [name, file] of files) {
      const target = path.resolve(temporary, name)
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error(`Archive path escapes destination: ${name}`)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.bytes, { flag: 'wx', mode: file.mode })
      await chmod(target, file.mode)
    }
    if (process.platform !== 'win32') {
      await mkdir(root)
      claimedRoot = true
    }
    await rename(temporary, root)
    return root
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if (claimedRoot) await rm(root, { recursive: true, force: true })
    throw error
  }
}
