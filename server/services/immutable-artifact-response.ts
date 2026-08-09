import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'

interface ImmutableArtifact {
  descriptor: {
    digest: string
    size: number
    content_type: string
  }
  body: ReadableStream<Uint8Array> | Uint8Array
}

export async function immutableArtifactResponse(
  event: H3Event,
  artifact: ImmutableArtifact,
  options: { filename?: string; headers?: Record<string, string> } = {},
) {
  const { descriptor } = artifact
  const etag = `"${descriptor.digest}"`
  setResponseHeader(event, 'content-type', descriptor.content_type)
  setResponseHeader(event, 'content-length', String(descriptor.size))
  if (options.filename) setResponseHeader(event, 'content-disposition', `attachment; filename="${options.filename}"`)
  setResponseHeader(event, 'etag', etag)
  setResponseHeader(event, 'x-content-sha256', descriptor.digest)
  setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  for (const [name, value] of Object.entries(options.headers ?? {})) setResponseHeader(event, name, value)

  const validators = (getHeader(event, 'if-none-match') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
  if (validators.includes('*') || validators.includes(etag)) {
    if (artifact.body instanceof ReadableStream) await artifact.body.cancel()
    setResponseStatus(event, 304)
    return null
  }
  return artifact.body
}
