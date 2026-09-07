import { z } from 'zod'
import type { SkillImageAsset } from '../types'

export const DEPENDENCY_REGISTRY = 'memoh'
export const MAX_DEPENDENCY_BYTES = 1024 * 1024
export const MAX_DEPENDENCY_FILES = 32
export const MAX_DEPENDENCY_INDEX_BYTES = 4 * 1024 * 1024
export const MAX_DEPENDENCIES = 256
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)
const text = z.string().trim().min(1).max(4096)
const file = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(128)
const timeout = z.number().int().positive().max(3600)
const translation = z.object({ name: text.optional(), description: text.optional() }).strict()

export const dependencyManifestSchema = z.object({
  schema_version: z.literal('1'),
  id,
  name: text,
  description: text,
  icon: file.optional(),
  translations: z.object({ en: translation.optional(), zh: translation.optional(), ja: translation.optional() }).strict().optional(),
  category: z.enum(['agent', 'runtime', 'tool']),
  source: z.enum(['managed', 'image']),
  requires: z.array(id).max(32).default([]),
  provides: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/).max(80)).min(1).max(32),
  platforms: z.array(z.object({
    os: z.enum(['linux', 'darwin']), arch: z.array(z.enum(['amd64', 'arm64'])).min(1),
    libc: z.enum(['glibc', 'musl']).optional(),
  }).strict()).min(1).max(16),
  version: z.object({ pin: text.optional(), channel: text.optional() }).strict().optional(),
  timeouts: z.object({ install: timeout.optional(), update: timeout.optional(), remove: timeout.optional(),
    check_update: timeout.optional(), version: timeout.optional(),
  }).strict().optional(),
  scripts: z.object({ install: file.optional(), update: file.optional(), remove: file.optional(),
    reinstall: file.optional(), check_update: file.optional(), version: file.optional(),
  }).strict().default({}),
}).strict()

export type DependencyManifest = z.infer<typeof dependencyManifestSchema>

export interface DependencyArtifact {
  format: 'memoh_dependency_v1'
  digest: string
  size: number
  uncompressed_size: number
  archive_size: number
  file_count: number
  content_type: 'application/gzip'
}

export interface DependencyRelease {
  schema_version: '1'
  registry_id: typeof DEPENDENCY_REGISTRY
  dependency_id: string
  manifest: DependencyManifest
  manifest_digest: string
  artifact: DependencyArtifact
  icon?: SkillImageAsset
}

export interface DependencyDescriptor extends DependencyRelease { revision: string }
export interface DependencySnapshot {
  schema_version: '1'
  registry_id: typeof DEPENDENCY_REGISTRY
  dependencies: DependencyDescriptor[]
}

export interface DependencyRegistryState {
  schema_version: '1'
  registry_id: typeof DEPENDENCY_REGISTRY
  enabled: boolean
  current_snapshot?: string
  published_at?: string
}

export function dependencyJSON(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

export function parseDependencyManifest(value: unknown): DependencyManifest {
  const manifest = dependencyManifestSchema.parse(value)
  if (manifest.source === 'image' && manifest.category === 'agent') throw new Error('Agent dependencies cannot have an image baseline')
  if (manifest.source === 'managed' && !manifest.scripts.install) throw new Error('Managed dependency requires install script')
  if (manifest.scripts.install && !manifest.scripts.remove) throw new Error('Installable dependency requires remove script')
  if (!manifest.scripts.install && Object.keys(manifest.scripts).length) throw new Error('Scripts require an install script')
  if (new Set(manifest.provides).size !== manifest.provides.length) throw new Error('Duplicate provided command')
  if (new Set(manifest.requires).size !== manifest.requires.length) throw new Error('Duplicate required dependency')
  return manifest
}

export function validateDependencyGraph(manifests: DependencyManifest[]) {
  const entries = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  if (entries.size !== manifests.length) throw new Error('Duplicate dependency ID')
  const visited = new Set<string>()
  const visiting = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`)
    if (visited.has(id)) return
    const entry = entries.get(id)
    if (!entry) throw new Error(`Unknown required dependency: ${id}`)
    visiting.add(id)
    for (const dependency of entry.requires) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const entry of manifests) visit(entry.id)
}
