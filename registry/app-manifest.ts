import { z } from 'zod'
import type { AppConnectorReference, AppManifest, AppPostinstallCommand, AppTranslations } from './types'
import { safeRelativePath } from './definition'

export const MAX_APP_MANIFEST_BYTES = 64 * 1024
export const MAX_APP_POSTINSTALL_COMMANDS = 8
export const MAX_APP_POSTINSTALL_ARGS = 64
export const MAX_APP_POSTINSTALL_COMMAND_BYTES = 128
export const MAX_APP_POSTINSTALL_ARG_BYTES = 4 * 1024
export const MAX_APP_POSTINSTALL_BYTES = 64 * 1024
export const MAX_APP_DEPENDENCIES = 32
export const MAX_APP_CONNECTORS = 32
export const MAX_APP_TAGS = 32
export const APP_MANIFEST_SCHEMA_VERSION = '2'

const executablePattern = /^[a-z0-9][a-z0-9._+-]*$/i
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u
const unsupportedExecutables = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'dash',
  'env',
  'fish',
  'powershell',
  'powershell.exe',
  'pwsh',
  'sh',
  'sudo',
  'zsh',
])
const encoder = new TextEncoder()

export const dependencyIDPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const connectorTypePattern = /^[a-z][a-z0-9_]*$/
export const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    }
    else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key))
  if (unsupported.length) throw new Error(`${label} contains unsupported field ${unsupported.join(', ')}`)
}

function boundedString(value: unknown, maximum: number, label: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || encoder.encode(value).length > maximum) {
    throw new Error(`${label} must be a string of at most ${maximum} bytes`)
  }
  if (!isWellFormedUnicode(value)) throw new Error(`${label} contains an unpaired UTF-16 surrogate`)
  if (controlCharacterPattern.test(value)) throw new Error(`${label} contains a control character`)
  return value
}

export function parseAppPostinstall(value: unknown, label: string): AppPostinstallCommand[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_APP_POSTINSTALL_COMMANDS) {
    throw new Error(`${label} must contain between 1 and ${MAX_APP_POSTINSTALL_COMMANDS} commands`)
  }
  const commands = value.map((raw, index) => {
    const commandLabel = `${label}[${index}]`
    const item = object(raw, commandLabel)
    rejectUnknownFields(item, new Set(['command', 'args']), commandLabel)
    const command = boundedString(
      item.command,
      MAX_APP_POSTINSTALL_COMMAND_BYTES,
      `${commandLabel}.command`,
    )
    if (!executablePattern.test(command) || unsupportedExecutables.has(command.toLowerCase())) {
      throw new Error(`${commandLabel}.command must be a supported executable name`)
    }
    if (!Array.isArray(item.args) || item.args.length > MAX_APP_POSTINSTALL_ARGS) {
      throw new Error(`${commandLabel}.args must contain at most ${MAX_APP_POSTINSTALL_ARGS} arguments`)
    }
    const args = item.args.map((arg, argIndex) => boundedString(
      arg,
      MAX_APP_POSTINSTALL_ARG_BYTES,
      `${commandLabel}.args[${argIndex}]`,
      true,
    ))
    return { command, args }
  })
  if (encoder.encode(JSON.stringify(commands)).length > MAX_APP_POSTINSTALL_BYTES) {
    throw new Error(`${label} exceeds ${MAX_APP_POSTINSTALL_BYTES} bytes`)
  }
  return commands
}

const text = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine(isWellFormedUnicode, 'contains an unpaired UTF-16 surrogate')
  .refine((value) => !controlCharacterPattern.test(value), 'contains a control character')
const url = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}, 'must be an http(s) URL')
const translation = z.object({ name: text(256).optional(), description: text(4096).optional() }).strict()

const appManifestSchema = z.object({
  schema_version: z.literal(APP_MANIFEST_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(128),
  version: z.string().trim().regex(semverPattern, 'must be a semantic version'),
  name: text(256),
  description: text(4096),
  author: z.object({ name: text(256), email: z.string().trim().max(320).optional() }).strict().optional(),
  homepage: url.optional(),
  repository: url.optional(),
  license: text(128).optional(),
  icon: z.string().trim().min(1).max(256).optional(),
  category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  tags: z.array(text(64)).max(MAX_APP_TAGS).default([]),
  translations: z.object({ en: translation.optional(), zh: translation.optional(), ja: translation.optional() })
    .strict().optional(),
  dependencies: z.array(z.string().regex(dependencyIDPattern).max(80)).max(MAX_APP_DEPENDENCIES).default([]),
  connectors: z.array(z.union([
    z.string().regex(connectorTypePattern).max(80),
    z.object({ type: z.string().regex(connectorTypePattern).max(80), required: z.boolean().default(true) }).strict(),
  ])).max(MAX_APP_CONNECTORS).default([]),
  postinstall: z.unknown().optional(),
}).strict()

function firstIssue(error: z.ZodError, label: string) {
  const issue = error.issues[0]!
  const where = issue.path.length ? `.${issue.path.join('.')}` : ''
  if (issue.code === 'unrecognized_keys') {
    return new Error(`${label} contains unsupported field ${(issue as { keys: string[] }).keys.join(', ')}`)
  }
  return new Error(`${label}${where}: ${issue.message}`)
}

/** Parses a `app.yaml` manifest (schema 2) without touching the file system. */
export function parseAppManifest(raw: unknown, label: string): AppManifest {
  const data = object(raw, label)
  if (data.schema_version !== APP_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`${label} uses unsupported schema_version ${String(data.schema_version)}`)
  }
  const parsed = appManifestSchema.safeParse(data)
  if (!parsed.success) throw firstIssue(parsed.error, label)
  const manifest = parsed.data
  const tags = [...new Set(manifest.tags.map((tag) => tag.trim()).filter(Boolean))]
  const dependencies = manifest.dependencies
  if (new Set(dependencies).size !== dependencies.length) throw new Error(`${label}.dependencies contains duplicates`)
  const connectors: AppConnectorReference[] = manifest.connectors.map((item) => typeof item === 'string'
    ? { type: item, required: true }
    : { type: item.type, required: item.required })
  if (new Set(connectors.map((item) => item.type)).size !== connectors.length) {
    throw new Error(`${label}.connectors contains duplicate connector types`)
  }
  const translations: AppTranslations | undefined = manifest.translations
    ? Object.fromEntries(Object.entries(manifest.translations).filter(([, value]) => value && Object.keys(value).length))
    : undefined
  return {
    schema_version: APP_MANIFEST_SCHEMA_VERSION,
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    ...(manifest.author ? { author: { name: manifest.author.name, email: manifest.author.email ?? '' } } : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest.repository ? { repository: manifest.repository } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.icon ? { icon: safeRelativePath(manifest.icon, `${label}.icon`) } : {}),
    category: manifest.category,
    tags,
    ...(translations && Object.keys(translations).length ? { translations } : {}),
    dependencies,
    connectors,
    ...(manifest.postinstall === undefined
      ? {}
      : { postinstall: parseAppPostinstall(manifest.postinstall, `${label}.postinstall`) }),
  }
}
