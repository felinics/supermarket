import { describe, expect, test } from 'bun:test'
import { S3BlobBackend } from './s3'

function backendWithMockClient() {
  const backend = new S3BlobBackend({
    accountID: 'account',
    accessKeyID: 'key',
    secretAccessKey: 'secret',
    bucket: 'bucket',
  })
  const client = (backend as unknown as { client: { send(): Promise<unknown> } }).client
  return { backend, client }
}

describe('S3BlobBackend', () => {
  test('does not treat a versioned read without an ETag as a missing object', async () => {
    const { backend, client } = backendWithMockClient()
    client.send = async () => ({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    })

    await expect(backend.getWithVersion('state.json')).rejects.toThrow('S3 object read without an ETag: state.json')
  })

  test('returns the SDK web stream without collecting the object', async () => {
    const { backend, client } = backendWithMockClient()
    const bytes = new TextEncoder().encode('streamed')
    let collected = false
    client.send = async () => ({
      Body: {
        transformToByteArray: async () => {
          collected = true
          return bytes
        },
        transformToWebStream: () => new Blob([bytes]).stream(),
      },
      ContentLength: bytes.length,
    })

    const result = await backend.getStream('artifact.tar.gz')

    expect(result?.size).toBe(bytes.length)
    expect(collected).toBe(false)
    expect(new Uint8Array(await new Response(result!.body).arrayBuffer())).toEqual(bytes)
    expect(collected).toBe(false)
  })

  test('does not invent a version when a conditional write has no ETag', async () => {
    const { backend, client } = backendWithMockClient()
    client.send = async () => ({})

    await expect(backend.putConditional('state.json', new Uint8Array([1]), null))
      .rejects.toThrow('S3 conditional write completed without an ETag: state.json')
  })
})
