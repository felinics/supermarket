import { sha256 } from '#lib/digest'
import { conditionalBlobBackend, type BlobBackend } from './contracts'

// Digest-addressed writes are retryable because every successful writer must
// produce identical bytes for a key. Mutable pointers use conditional writes
// elsewhere and deliberately do not share this recovery behavior.
export async function putImmutableObject(
  backend: BlobBackend,
  key: string,
  bytes: Uint8Array,
  label: string,
) {
  const conditional = conditionalBlobBackend(backend)
  const expected = await sha256(bytes)
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, attempt === 2 ? 500 : 1_500))
    try {
      if (conditional) {
        const created = await conditional.putConditional(key, bytes, null)
        if (created) return true
        const stored = await backend.get(key)
        if (!stored) throw new Error(`${label} appeared but could not be read: ${key}`)
        if (stored.length !== bytes.length || await sha256(stored) !== expected) {
          throw new Error(`${label} is immutable: ${key}`)
        }
        return false
      }
      const stored = await backend.get(key)
      if (stored) {
        if (stored.length !== bytes.length || await sha256(stored) !== expected) {
          throw new Error(`${label} is immutable: ${key}`)
        }
        return false
      }
      await backend.put(key, bytes)
      return true
    } catch (error) {
      if (error instanceof Error && error.message === `${label} is immutable: ${key}`) throw error
      lastError = error
    }
    const stored = await backend.get(key).catch(() => null)
    if (stored && stored.length === bytes.length && await sha256(stored) === expected) return true
  }
  throw new Error(`${label} upload did not complete: ${key}`, { cause: lastError })
}
