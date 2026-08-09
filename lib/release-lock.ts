import { readFile, writeFile } from 'node:fs/promises'
import { assertDigest } from './digest'

export type DigestLock<Field extends string> = Record<Field, string>

export function serializeDigestLock<Field extends string>(lock: DigestLock<Field>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(lock, null, 2)}\n`)
}

export function parseDigestLock<Field extends string>(
  bytes: Uint8Array,
  field: Field,
  label: string,
): DigestLock<Field> {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`${label} must contain valid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, field)
    || typeof (value as Record<string, unknown>)[field] !== 'string') {
    throw new Error(`${label} must contain a valid ${field}`)
  }
  const lock = value as DigestLock<Field>
  try {
    assertDigest(lock[field])
  } catch {
    throw new Error(`${label} must contain a valid ${field}`)
  }
  const canonical = serializeDigestLock(lock)
  if (canonical.length !== bytes.length || !canonical.every((byte, index) => byte === bytes[index])) {
    throw new Error(`${label} must use canonical JSON formatting`)
  }
  return lock
}

export async function loadDigestLock<Field extends string>(file: string, field: Field, label: string) {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label} is required`)
    throw error
  }
  return parseDigestLock(bytes, field, label)
}

export async function writeDigestLock<Field extends string>(
  file: string,
  field: Field,
  label: string,
  lock: DigestLock<Field>,
) {
  const bytes = serializeDigestLock(lock)
  parseDigestLock(bytes, field, label)
  await writeFile(file, bytes)
}
