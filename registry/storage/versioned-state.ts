import {
  conditionalBlobBackend,
  type BlobBackend,
  type VersionedStateRead,
} from './contracts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface VersionedJSONStateOptions<State> {
  label: string
  maxBytes: number
  normalizeID(id: string): string
  stateID(state: State): string
  key(id: string): string
  validate(state: State, id: string): void
}

export class VersionedJSONState<State> {
  private readonly conditionalBackend

  constructor(
    private readonly backend: BlobBackend,
    private readonly options: VersionedJSONStateOptions<State>,
  ) {
    this.conditionalBackend = conditionalBlobBackend(backend)
  }

  async get(idValue: string): Promise<VersionedStateRead<State>> {
    const id = this.options.normalizeID(idValue)
    const key = this.options.key(id)
    if (this.conditionalBackend) {
      const result = await this.conditionalBackend.getWithVersion(key)
      if (!result) return { state: null, versioning: 'conditional', version: null }
      return {
        state: this.parse(result.value, id, key),
        versioning: 'conditional',
        version: result.version,
      }
    }
    const bytes = await this.backend.get(key)
    return {
      state: bytes ? this.parse(bytes, id, key) : null,
      versioning: 'none',
    }
  }

  async put(state: State, expectedVersion?: string | null) {
    const id = this.options.normalizeID(this.options.stateID(state))
    this.options.validate(state, id)
    const bytes = encoder.encode(`${JSON.stringify(state, null, 2)}\n`)
    if (bytes.length > this.options.maxBytes) {
      throw new Error(`${this.options.label} exceeds ${this.options.maxBytes} bytes: ${id}`)
    }
    const key = this.options.key(id)
    if (expectedVersion !== undefined) {
      if (!this.conditionalBackend) {
        throw new Error(`${this.options.label} backend does not support conditional writes: ${id}`)
      }
      const version = await this.conditionalBackend.putConditional(key, bytes, expectedVersion)
      if (!version) throw new Error(`${this.options.label} changed concurrently, refusing to overwrite: ${id}`)
      return
    }
    await this.backend.put(key, bytes)
  }

  private parse(bytes: Uint8Array, id: string, key: string) {
    if (bytes.length > this.options.maxBytes) {
      throw new Error(`Stored ${this.options.label} exceeds ${this.options.maxBytes} bytes: ${key}`)
    }
    const state = JSON.parse(decoder.decode(bytes)) as State
    this.options.validate(state, id)
    return state
  }
}
