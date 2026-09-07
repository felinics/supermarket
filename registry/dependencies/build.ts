import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { readDirectoryFiles } from '../filesystem'
import { createTar, gzip } from '#lib/archive'
import { sha256 } from '#lib/digest'
import { compareCanonicalText } from '#lib/order'
import { DEPENDENCY_REGISTRY, MAX_DEPENDENCIES, MAX_DEPENDENCY_BYTES, MAX_DEPENDENCY_FILES,
  MAX_DEPENDENCY_INDEX_BYTES, dependencyJSON, parseDependencyManifest, validateDependencyGraph,
  type DependencyRelease, type DependencySnapshot,
} from './types'

export async function buildDependencyCandidate(projectRoot: string) {
  const root = path.join(projectRoot, 'registries', DEPENDENCY_REGISTRY, 'dependencies')
  const dirs = (await readdir(root, { withFileTypes: true })).sort((a, b) => compareCanonicalText(a.name, b.name))
  if (dirs.length > MAX_DEPENDENCIES) throw new Error('Dependency catalog exceeds entry budget')
  const releases: DependencyRelease[] = []
  const artifacts = new Map<string, Uint8Array>()
  const icons = new Map<string, Uint8Array>()
  for (const dir of dirs) {
    if (!dir.isDirectory()) throw new Error(`Expected dependency directory: ${dir.name}`)
    const files = await readDirectoryFiles(path.join(root, dir.name), root)
    const manifestFile = files['dependency.yaml']
    if (!manifestFile) throw new Error(`${dir.name}: dependency.yaml is required`)
    const document = parseDocument(new TextDecoder().decode(manifestFile.bytes), { uniqueKeys: true })
    if (document.errors.length) throw new Error(`${dir.name}: ${document.errors[0]!.message}`)
    const manifest = parseDependencyManifest(document.toJS({ maxAliasCount: 0 }))
    if (manifest.id !== dir.name) throw new Error(`${dir.name}: manifest ID must match directory`)
    const scriptFiles = [...new Set(Object.values(manifest.scripts))]
    const expected = new Set(['dependency.yaml', ...scriptFiles, ...(manifest.icon ? [manifest.icon] : [])])
    if (Object.keys(files).some((name) => !expected.has(name))) throw new Error(`${dir.name}: unreferenced file in dependency`)
    for (const name of scriptFiles) {
      if (!files[name] || !new TextDecoder().decode(files[name].bytes).trim()) throw new Error(`${dir.name}: missing or empty script ${name}`)
    }
    const contentBytes = Object.values(files).reduce((sum, item) => sum + item.bytes.length, 0)
    if (Object.keys(files).length > MAX_DEPENDENCY_FILES || contentBytes > MAX_DEPENDENCY_BYTES) throw new Error(`${dir.name}: dependency artifact exceeds budget`)
    // Same file framing as Memoh's catalog.DigestFiles. Icons are separate
    // assets; the installation digest covers the manifest and its scripts.
    const chunks: Uint8Array[] = []
    for (const name of ['dependency.yaml', ...scriptFiles].sort(compareCanonicalText)) {
      const bytes = files[name]!.bytes
      chunks.push(new TextEncoder().encode(`${name}\0${bytes.length}\0`), bytes)
    }
    const framed = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0))
    let offset = 0
    for (const bytes of chunks) { framed.set(bytes, offset); offset += bytes.length }
    const tar = await createTar(files, '')
    const archive = await gzip(tar)
    if (tar.length > MAX_DEPENDENCY_BYTES || archive.length > MAX_DEPENDENCY_BYTES) throw new Error(`${dir.name}: archive exceeds budget`)
    const digest = await sha256(archive)
    artifacts.set(digest, archive)
    const release: DependencyRelease = {
      schema_version: '1', registry_id: DEPENDENCY_REGISTRY, dependency_id: manifest.id, manifest,
      manifest_digest: `sha256:${await sha256(framed)}`,
      artifact: { format: 'memoh_dependency_v1', digest, size: archive.length,
        uncompressed_size: contentBytes, archive_size: tar.length, file_count: Object.keys(files).length,
        content_type: 'application/gzip' },
    }
    if (manifest.icon) {
      const icon = files[manifest.icon]
      if (!icon || icon.bytes.length > 512 * 1024 || !manifest.icon.endsWith('.svg')) throw new Error(`${dir.name}: icon must be an SVG under 512 KiB`)
      const iconDigest = await sha256(icon.bytes)
      release.icon = { digest: iconDigest, size: icon.bytes.length, content_type: 'image/svg+xml' }
      icons.set(iconDigest, icon.bytes)
    }
    releases.push(release)
  }
  validateDependencyGraph(releases.map((release) => release.manifest))
  const dependencies = await Promise.all(releases.map(async (release) => ({ ...release, revision: await sha256(dependencyJSON(release)) })))
  const snapshot: DependencySnapshot = { schema_version: '1', registry_id: DEPENDENCY_REGISTRY, dependencies }
  const bytes = dependencyJSON(snapshot)
  if (bytes.length > MAX_DEPENDENCY_INDEX_BYTES) throw new Error('Dependency index exceeds budget')
  return { releases, artifacts, icons, snapshot, bytes, revision: await sha256(bytes) }
}
