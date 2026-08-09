import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StreamingBlobBackend } from './contracts'
import { BlobSkillRegistryStore } from './blob'

export class LocalBlobBackend implements StreamingBlobBackend {
  constructor(readonly root: string) {}

  private resolve(key: string) {
    const normalized = path.posix.normalize(key.replaceAll('\\', '/'))
    if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      throw new Error(`Invalid SkillRegistryStore key: ${key}`)
    }
    return path.join(this.root, normalized)
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.resolve(key)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async put(key: string, value: Uint8Array) {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.tmp-${crypto.randomUUID()}`
    try {
      await writeFile(temporary, value)
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async getStream(key: string) {
    const target = this.resolve(key)
    let size: number
    try {
      const metadata = await stat(target)
      if (!metadata.isFile()) throw new Error(`Expected regular file: ${target}`)
      size = metadata.size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const input = createReadStream(target)
    const iterator = input[Symbol.asyncIterator]()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await iterator.next()
        if (done) controller.close()
        else controller.enqueue(value)
      },
      cancel() {
        input.destroy()
      },
    })
    return { body, size }
  }

  async list(prefix: string) {
    const base = this.resolve(prefix)
    const keys: string[] = []
    const visit = async (directory: string) => {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        const child = path.join(directory, entry.name)
        if (entry.isDirectory()) await visit(child)
        else if (entry.isFile()) keys.push(path.relative(this.root, child).replaceAll(path.sep, '/'))
      }
    }
    await visit(base)
    return keys
  }

  async listPrefixes(prefix: string) {
    const normalized = prefix.replaceAll('\\', '/').replace(/\/?$/, '/')
    const base = this.resolve(normalized)
    try {
      const entries = await readdir(base, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${normalized}${entry.name}/`)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

}

export class LocalSkillRegistryStore extends BlobSkillRegistryStore {
  constructor(root = process.env.REGISTRY_DATA_DIR || path.resolve(process.cwd(), '.data/registries')) {
    super(new LocalBlobBackend(root))
  }
}
