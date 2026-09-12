import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'

const root = path.resolve(import.meta.dirname, '../..')
const directory = path.join(root, 'registries/memoh/dependencies')
const catalog: Record<string, unknown> = {}
for (const id of await readdir(directory)) {
  catalog[id] = parse(await readFile(path.join(directory, id, 'dependency.yaml'), 'utf8'))
}
await mkdir(path.join(root, '.cache/toolchain-qa'), { recursive: true })
await writeFile(path.join(root, '.cache/toolchain-qa/catalog.json'), JSON.stringify(catalog))
