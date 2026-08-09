import { createGzipEncoder, packTar, type TarEntry } from 'modern-tar'
import { compareCanonicalText } from './order'

export const MAX_TAR_UNCOMPRESSED_BYTES = 5 * 1024 * 1024
const gzipHeaderLength = 10
const gzipMinimumLength = gzipHeaderLength + 8

export interface TarFileInput {
  bytes: Uint8Array
  mode: 0o644 | 0o755
}

export function canonicalArchivePath(name: string) {
  return name.toLowerCase().normalize('NFC')
}

const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function assertSafeArchivePath(name: string, label = 'tar') {
  const segments = name.split('/')
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)
    || segments.some((segment) => !segment || segment === '.' || segment === '..'
      || segment !== segment.trim() || segment.endsWith('.') || windowsReservedNamePattern.test(segment)
      || /[<>:"|?*\u0000-\u001f\u007f]/u.test(segment))) {
    throw new Error(`Unsafe ${label} path: ${name}`)
  }
  return name
}

export function assertSafeArchivePaths(
  names: Iterable<string>,
  label = 'tar',
) {
  const seen = new Map<string, string>()
  for (const name of names) {
    assertSafeArchivePath(name, label)
    const canonical = canonicalArchivePath(name)
    const previous = seen.get(canonical)
    if (previous) throw new Error(`Duplicate ${label} path: ${name} conflicts with ${previous}`)
    seen.set(canonical, name)
  }
  for (const [canonical, name] of seen) {
    const segments = canonical.split('/')
    for (let index = 1; index < segments.length; index++) {
      const parent = seen.get(segments.slice(0, index).join('/'))
      if (parent) throw new Error(`Conflicting ${label} path: ${name} is nested below ${parent}`)
    }
  }
}

export async function createTar(
  files: Record<string, Uint8Array | TarFileInput>,
  prefix: string,
): Promise<Uint8Array> {
  if (prefix) assertSafeArchivePath(prefix)
  const fileEntries = Object.entries(files)
  assertSafeArchivePaths(fileEntries.map(([name]) => name), 'tar')
  if (prefix) assertSafeArchivePaths(fileEntries.map(([name]) => `${prefix}/${name}`))
  let contentBytes = 0
  const entries: TarEntry[] = fileEntries
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([name, input]) => {
      const archivePath = prefix ? `${prefix}/${name}` : name
      const body = input instanceof Uint8Array ? input : input.bytes
      const mode = input instanceof Uint8Array ? 0o644 : input.mode
      contentBytes += body.length
      if (contentBytes > MAX_TAR_UNCOMPRESSED_BYTES) {
        throw new Error(`Tar archive exceeds ${MAX_TAR_UNCOMPRESSED_BYTES} content bytes`)
      }
      return {
        header: {
          name: archivePath,
          size: body.length,
          type: 'file',
          mode: mode === 0o755 ? 0o755 : 0o644,
          mtime: new Date(0),
          uid: 0,
          gid: 0,
          uname: '',
          gname: '',
        },
        body,
      }
    })

  const archive = await packTar(entries)
  if (archive.length > MAX_TAR_UNCOMPRESSED_BYTES) {
    throw new Error(`Tar archive exceeds ${MAX_TAR_UNCOMPRESSED_BYTES} serialized bytes`)
  }
  return archive
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const input = new Blob([data.slice().buffer as ArrayBuffer]).stream()
  const compressed = new Uint8Array(await new Response(input.pipeThrough(createGzipEncoder())).arrayBuffer())
  if (compressed.length < gzipMinimumLength
    || compressed[0] !== 0x1f || compressed[1] !== 0x8b || compressed[2] !== 0x08
    || compressed[3] !== 0) {
    throw new Error('Gzip encoder returned an unsupported member header')
  }
  // CompressionStream delegates to the host runtime, which records its OS in
  // the otherwise non-semantic gzip header. Normalize those metadata bytes so
  // digest-addressed archives are reproducible across supported runtimes.
  compressed.fill(0, 4, 9)
  compressed[9] = 0xff
  return compressed
}
