export const MAX_REGISTRY_JSON_BYTES = 5 * 1024 * 1024
export const MAX_ERROR_RESPONSE_BYTES = 64 * 1024
export const REGISTRY_REQUEST_TIMEOUT_MS = 30_000

export async function readBoundedResponse(response: Response, limit: number, label: string) {
  const contentLength = response.headers.get('content-length')
  const declared = contentLength === null ? Number.NaN : Number(contentLength)
  if (Number.isFinite(declared) && declared > limit) throw new Error(`${label} exceeds size limit`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${label} has no body`)
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error(`${label} exceeds size limit`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

export async function responseError(response: Response) {
  let detail = ''
  try {
    detail = new TextDecoder().decode(await readBoundedResponse(response, MAX_ERROR_RESPONSE_BYTES, 'Error response'))
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error)
  }
  return new Error(`${response.status} ${response.statusText}: ${detail}`)
}

export function resolveArtifactDownloadURL(value: unknown, base: string) {
  if (typeof value !== 'string' || !value) throw new Error('Artifact descriptor has no download URL')
  const baseURL = new URL(base)
  const artifactURL = new URL(value, baseURL)
  if (!['http:', 'https:'].includes(artifactURL.protocol) || artifactURL.origin !== baseURL.origin) {
    throw new Error('Artifact download URL must use the Supermarket origin')
  }
  return artifactURL.toString()
}
