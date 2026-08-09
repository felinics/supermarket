const encoder = new TextEncoder()

export function assertDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid artifact digest: ${value}`)
  return value
}

export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('')
}
