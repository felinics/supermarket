import { describe, expect, test } from 'bun:test'
import { readBoundedResponse, resolveArtifactDownloadURL } from './protocol'

describe('Skill Registry client protocol', () => {
  test('accepts Supermarket Artifact paths and rejects cross-origin downloads', () => {
    expect(resolveArtifactDownloadURL('/api/artifacts/skill/abc', 'https://supermarket.memoh.ai'))
      .toBe('https://supermarket.memoh.ai/api/artifacts/skill/abc')
    expect(resolveArtifactDownloadURL('https://supermarket.memoh.ai/api/artifacts/skill/abc', 'https://supermarket.memoh.ai'))
      .toBe('https://supermarket.memoh.ai/api/artifacts/skill/abc')
    expect(() => resolveArtifactDownloadURL('https://github.com/example/archive.tar.gz', 'https://supermarket.memoh.ai'))
      .toThrow('Supermarket origin')
  })

  test('bounds response bodies even without Content-Length', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
        controller.enqueue(new Uint8Array(8))
        controller.close()
      },
    }))
    await expect(readBoundedResponse(response, 10, 'Test response')).rejects.toThrow('size limit')
  })
})
