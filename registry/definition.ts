import path from 'node:path'
import * as z from 'zod/mini'
import { MAX_REGISTRY_APP_SKILLS, MAX_REGISTRY_SKILLS } from './budget'
import type { AppTranslation, AppTranslations, SkillAuthor, SkillPackApp, SkillRegistryDefinition } from './types'

export const MAX_RESOURCE_ID_BYTES = 128
const safeIDPattern = /^[a-z0-9][a-z0-9_-]*$/
const registryComponentPattern = /^[a-z0-9][a-z0-9._-]*$/
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const gitRevisionPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

function unsupportedFieldError(label: string) {
  return { error: (issue: z.core.$ZodRawIssue) => issue.code === 'unrecognized_keys'
    ? `${label} contains unsupported field ${(issue as { keys: string[] }).keys.join(', ')}`
    : undefined }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function assertIdentifier(value: string, label = 'ID'): string {
  if (value.length > MAX_RESOURCE_ID_BYTES || !safeIDPattern.test(value)
    || windowsReservedNamePattern.test(value)) throw new Error(`Invalid ${label}: ${value}`)
  return value
}

export function assertRegistryID(value: string, label = 'registry ID'): string {
  const id = assertRegistryComponentID(value, label)
  if (id === 'user') throw new Error(`Reserved ${label}: ${value}`)
  return id
}

export function isIdentifier(value: string): boolean {
  return value.length <= MAX_RESOURCE_ID_BYTES && safeIDPattern.test(value)
    && !windowsReservedNamePattern.test(value)
}

export function assertRegistryComponentID(value: string, label = 'Registry component ID'): string {
  if (value.length > MAX_RESOURCE_ID_BYTES || !registryComponentPattern.test(value)
    || value.includes('..') || value.endsWith('.') || windowsReservedNamePattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return value
}

export function isRegistryComponentID(value: string): boolean {
  try {
    assertRegistryComponentID(value)
    return true
  } catch {
    return false
  }
}

export function skillInstallID(registryID: string, appID: string, skillID: string): string {
  return [
    assertRegistryID(registryID, 'registry ID'),
    assertRegistryComponentID(appID, 'app ID'),
    assertRegistryComponentID(skillID, 'skill ID'),
  ].join('+')
}

export function safeRelativePath(value: string, label = 'path'): string {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} escapes its source: ${value}`)
  }
  return normalized === '.' ? '' : normalized
}

function parseAdapter(raw: unknown, id: string): SkillRegistryDefinition['adapter'] {
  const data = object(raw, `${id}: adapter`)
  const type = String(data.type ?? '')
  if (type === 'skill_directory') {
    const parsed = z.strictObject({ type: z.literal('skill_directory') }, {
      error: (issue) => issue.code === 'unrecognized_keys' ? `${id}: skill_directory adapter contains unsupported fields` : undefined,
    }).safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0]!.message)
    return { type: 'skill_directory' }
  }
  if (type === 'memoh') {
    const parsed = z.strictObject({ type: z.literal('memoh') }, {
      error: (issue) => issue.code === 'unrecognized_keys' ? `${id}: memoh adapter contains unsupported fields` : undefined,
    }).safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0]!.message)
    return { type: 'memoh' }
  }
  if (type === 'codex_marketplace_skills') {
    const parsed = z.strictObject({
      type: z.literal('codex_marketplace_skills'),
      catalog_path: z.pipe(z.string(), z.transform((value) => value.trim())).check(z.minLength(1)),
    }, {
      error: (issue) => issue.code === 'unrecognized_keys' ? `${id}: codex_marketplace_skills adapter contains unsupported fields` : undefined,
    }).safeParse(data)
    if (!parsed.success) throw new Error(`${id}: adapter.catalog_path is required for ${type}`)
    return { type: 'codex_marketplace_skills', catalog_path: safeRelativePath(parsed.data.catalog_path, 'catalog path') }
  }
  if (type === 'skill_pack') return parseSkillPackAdapter(data, id)
  throw new Error(`${id}: unsupported adapter ${type}`)
}

const skillPackTextLimit = { name: 256, description: 4096, license: 128, email: 320, tag: 64, url: 2048 }
const skillPackSemverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const skillPackCategoryPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const skillPackControlCharacterPattern = /[\u0000-\u001f\u007f]/u
const skillPackLocales = ['en', 'zh', 'ja'] as const

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw new Error(`${label} contains unsupported field ${unsupported.join(', ')}`)
}

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    }
    else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false
  }
  return true
}

function requiredText(value: unknown, maximum: number, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string of at most ${maximum} bytes`)
  const text = value.trim()
  if (!text || new TextEncoder().encode(text).length > maximum || !isWellFormedUnicode(text)) {
    throw new Error(`${label} must be a string of at most ${maximum} bytes`)
  }
  if (skillPackControlCharacterPattern.test(text)) throw new Error(`${label} contains a control character`)
  return text
}

function optionalText(value: unknown, maximum: number, label: string) {
  if (value === undefined) return undefined
  return requiredText(value, maximum, label)
}

function httpUrl(value: unknown, label: string) {
  const text = requiredText(value, skillPackTextLimit.url, label)
  try {
    const parsed = new URL(text)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return text
  } catch {
    // The message below covers both malformed and non-HTTP URLs.
  }
  throw new Error(`${label} must be an http(s) URL`)
}

function parseSkillPackAuthor(value: unknown, label: string): SkillAuthor | undefined {
  if (value === undefined) return undefined
  const author = object(value, label)
  rejectUnknownFields(author, ['name', 'email'], label)
  const email = author.email === undefined || author.email === ''
    ? ''
    : requiredText(author.email, skillPackTextLimit.email, `${label}.email`)
  return { name: requiredText(author.name, skillPackTextLimit.name, `${label}.name`), email }
}

function parseSkillPackTranslations(value: unknown, label: string): AppTranslations | undefined {
  if (value === undefined) return undefined
  const data = object(value, label)
  rejectUnknownFields(data, skillPackLocales, label)
  const translations: AppTranslations = {}
  for (const locale of skillPackLocales) {
    if (data[locale] === undefined) continue
    const item = object(data[locale], `${label}.${locale}`)
    rejectUnknownFields(item, ['name', 'description'], `${label}.${locale}`)
    const entry: AppTranslation = {}
    const name = optionalText(item.name, skillPackTextLimit.name, `${label}.${locale}.name`)
    const description = optionalText(item.description, skillPackTextLimit.description, `${label}.${locale}.description`)
    if (name) entry.name = name
    if (description) entry.description = description
    if (Object.keys(entry).length) translations[locale] = entry
  }
  return Object.keys(translations).length ? translations : undefined
}

function parseSkillPackApp(value: unknown, label: string): SkillPackApp {
  const app = object(value, label)
  rejectUnknownFields(app, [
    'id', 'version', 'name', 'description', 'author', 'homepage', 'repository', 'license',
    'category', 'tags', 'translations',
  ], label)
  const category = requiredText(app.category, 64, `${label}.category`)
  if (!skillPackCategoryPattern.test(category)) throw new Error(`${label}.category must be a category ID`)
  let version: string | undefined
  if (app.version !== undefined) {
    version = requiredText(app.version, 128, `${label}.version`)
    if (!skillPackSemverPattern.test(version)) throw new Error(`${label}.version must be a semantic version`)
  }
  const tags = app.tags === undefined ? [] : parseSkillPackTags(app.tags, `${label}.tags`)
  const author = parseSkillPackAuthor(app.author, `${label}.author`)
  const homepage = app.homepage === undefined ? undefined : httpUrl(app.homepage, `${label}.homepage`)
  const repository = app.repository === undefined ? undefined : httpUrl(app.repository, `${label}.repository`)
  const license = optionalText(app.license, skillPackTextLimit.license, `${label}.license`)
  const translations = parseSkillPackTranslations(app.translations, `${label}.translations`)
  return {
    id: assertRegistryComponentID(requiredText(app.id, MAX_RESOURCE_ID_BYTES, `${label}.id`), `${label}.id`),
    ...(version ? { version } : {}),
    name: requiredText(app.name, skillPackTextLimit.name, `${label}.name`),
    description: requiredText(app.description, skillPackTextLimit.description, `${label}.description`),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(license ? { license } : {}),
    category,
    tags,
    ...(translations ? { translations } : {}),
  }
}

function parseSkillPackTags(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${label} must contain at most 32 tags`)
  return [...new Set(value.map((item, index) => requiredText(item, skillPackTextLimit.tag, `${label}[${index}]`)))]
}

function parseSkillPackPaths(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REGISTRY_APP_SKILLS) {
    throw new Error(`${label} must contain between 1 and ${MAX_REGISTRY_APP_SKILLS} paths`)
  }
  const skills = value.map((item, index) => {
    const skillLabel = `${label}[${index}]`
    return safeRelativePath(requiredText(item, 1024, skillLabel), skillLabel)
  })
  if (new Set(skills).size !== skills.length) throw new Error(`${label} contains duplicate paths`)
  const ids = skills.map((skillPath) => assertRegistryComponentID(path.posix.basename(skillPath), `${label} skill ID`))
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate skill IDs`)
  return skills
}

function parseSkillPackAdapter(data: Record<string, unknown>, id: string): SkillRegistryDefinition['adapter'] {
  const label = `${id}: skill_pack adapter`
  rejectUnknownFields(data, ['type', 'app', 'skills', 'apps'], label)
  const hasSingle = data.app !== undefined || data.skills !== undefined
  const hasMany = data.apps !== undefined
  if (hasSingle === hasMany) throw new Error(`${label} must contain either app and skills, or apps`)
  const entries = hasMany
    ? parseSkillPackApps(data.apps, `${label}.apps`)
    : [{ app: parseSkillPackApp(data.app, `${label}.app`), skills: parseSkillPackPaths(data.skills, `${label}.skills`) }]
  const skillCount = entries.reduce((total, entry) => total + entry.skills.length, 0)
  if (skillCount > MAX_REGISTRY_SKILLS) {
    throw new Error(`${label} must contain at most ${MAX_REGISTRY_SKILLS} skills`)
  }
  const appIDs = new Set<string>()
  const paths = new Set<string>()
  for (const entry of entries) {
    if (appIDs.has(entry.app.id)) throw new Error(`${label} contains duplicate app ID ${entry.app.id}`)
    appIDs.add(entry.app.id)
    for (const skillPath of entry.skills) {
      if (paths.has(skillPath)) throw new Error(`${label} contains duplicate path ${skillPath}`)
      paths.add(skillPath)
    }
  }
  return { type: 'skill_pack', apps: entries }
}

function parseSkillPackApps(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REGISTRY_APP_SKILLS) {
    throw new Error(`${label} must contain between 1 and ${MAX_REGISTRY_APP_SKILLS} apps`)
  }
  return value.map((item, index) => {
    const appLabel = `${label}[${index}]`
    const app = object(item, appLabel)
    rejectUnknownFields(app, [
      'id', 'version', 'name', 'description', 'author', 'homepage', 'repository', 'license',
      'category', 'tags', 'translations', 'skills',
    ], appLabel)
    const { skills, ...manifest } = app
    return { app: parseSkillPackApp(manifest, appLabel), skills: parseSkillPackPaths(skills, `${appLabel}.skills`) }
  })
}

function parseSource(raw: unknown, id: string): SkillRegistryDefinition['source'] {
  const data = object(raw, `${id}: source`)
  if (data.type === 'local') {
    const parsed = z.strictObject({
      type: z.literal('local'),
      path: z.pipe(z.string(), z.transform((value) => value.trim())).check(z.minLength(1)),
    }, unsupportedFieldError(`${id}: local source`)).safeParse(data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!
      if (issue.code === 'unrecognized_keys') throw new Error(issue.message)
      throw new Error(`${id}: local source.path is required`)
    }
    return { type: 'local', path: parsed.data.path === '.' ? '' : safeRelativePath(parsed.data.path, 'local source path') }
  }
  if (data.type === 'git') {
    const parsed = z.strictObject({
      type: z.literal('git'),
      url: z.pipe(z.string(), z.transform((value) => value.trim()))
        .check(z.refine((value) => /^https:\/\//.test(value), `${id}: git source URL must use HTTPS`)),
      revision: z.pipe(z.string(), z.transform((value) => value.trim().toLowerCase()))
        .check(z.regex(gitRevisionPattern)),
      tracking_ref: z.optional(z.pipe(z.string(), z.transform((value) => value.trim())).check(z.minLength(1))),
      path: z.optional(z.string()),
    }, unsupportedFieldError(`${id}: git source`)).safeParse(data)
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'revision')) {
        throw new Error(`${id}: git source.revision must be a full commit hash`)
      }
      throw new Error(parsed.error.issues[0]!.message)
    }
    return {
      type: 'git', url: parsed.data.url,
      revision: parsed.data.revision,
      tracking_ref: parsed.data.tracking_ref,
      path: parsed.data.path ? safeRelativePath(String(parsed.data.path), 'git source path') : undefined,
    }
  }
  throw new Error(`${id}: unsupported source type ${String(data.type)}`)
}

export function parseSkillRegistryDefinition(raw: unknown): SkillRegistryDefinition {
  const data = object(raw, 'Registry definition')
  const id = assertRegistryID(String(data.id ?? '').trim(), 'registry ID')
  const parsed = z.strictObject({
    schema_version: z.unknown(),
    id: z.unknown(),
    name: z.pipe(z.string(), z.transform((value) => value.trim())).check(z.minLength(1)),
    enabled: z.optional(z.boolean()),
    priority: z.optional(z.number().check(z.int(), z.refine(Number.isSafeInteger))),
    adapter: z.unknown(),
    source: z.unknown(),
  }, {
    error: (issue) => issue.code === 'unrecognized_keys'
      ? `${id}: unsupported Registry field ${(issue as { keys: string[] }).keys.join(', ')}`
      : undefined,
  }).safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    if (issue.code === 'unrecognized_keys') throw new Error(issue.message)
    if (issue.path[0] === 'name') throw new Error(`${id}: name is required`)
    throw new Error(issue.message)
  }
  if (data.schema_version !== '1') throw new Error(`${id}: unsupported schema_version ${String(data.schema_version)}`)
  return {
    schema_version: '1', id, name: parsed.data.name,
    enabled: parsed.data.enabled ?? true,
    priority: parsed.data.priority ?? 0,
    adapter: parseAdapter(data.adapter, id),
    source: parseSource(data.source, id),
  }
}
