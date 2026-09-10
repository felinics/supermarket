import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { compareCanonicalText } from '#lib/order'

export const CATEGORY_TABLE_FILE = 'categories.yaml'
export const DEFAULT_CATEGORY_ID = 'other'
export const PACKAGE_LOCALES = ['en', 'zh', 'ja'] as const
export type PackageLocale = (typeof PACKAGE_LOCALES)[number]

const categoryID = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64)
const text = z.string().trim().min(1).max(256)

const categoryDefinitionSchema = z.object({
  id: categoryID,
  name: z.object({ en: text, zh: text.optional(), ja: text.optional() }).strict(),
  aliases: z.array(text).max(32).default([]),
  order: z.number().int().min(0).max(100_000).default(1000),
}).strict()

const categoryTableSchema = z.object({
  schema_version: z.literal('1'),
  categories: z.array(categoryDefinitionSchema).min(1).max(256),
}).strict()

export type CategoryDefinition = z.infer<typeof categoryDefinitionSchema>

/** Localized category names; `en` is always present. */
export type CategoryNames = CategoryDefinition['name']

export interface SnapshotCategory {
  id: string
  name: CategoryNames
  order: number
}

export function slugifyCategory(value: string) {
  return value.normalize('NFKD').toLowerCase().trim().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The shared category table (`registries/categories.yaml`). Reviewed
 * registries must use its IDs; imported registries are mapped through
 * aliases and fall back to `other`.
 */
export class CategoryTable {
  private readonly byID = new Map<string, CategoryDefinition>()
  private readonly byAlias = new Map<string, CategoryDefinition>()

  constructor(readonly categories: CategoryDefinition[]) {
    for (const category of categories) {
      if (this.byID.has(category.id)) throw new Error(`Duplicate category ID: ${category.id}`)
      this.byID.set(category.id, category)
    }
    for (const category of categories) {
      for (const alias of [category.id, category.name.en, ...category.aliases]) {
        const key = slugifyCategory(alias)
        if (!key) continue
        const existing = this.byAlias.get(key)
        if (existing && existing.id !== category.id) {
          throw new Error(`Category alias "${alias}" is claimed by both ${existing.id} and ${category.id}`)
        }
        this.byAlias.set(key, category)
      }
    }
    if (!this.byID.has(DEFAULT_CATEGORY_ID)) {
      throw new Error(`Category table must define the "${DEFAULT_CATEGORY_ID}" category`)
    }
  }

  has(id: string) {
    return this.byID.has(id)
  }

  get(id: string) {
    return this.byID.get(id)
  }

  /** Strict lookup for reviewed registries: the value must be a known category ID. */
  require(id: string, label: string) {
    const category = this.byID.get(id)
    if (!category) throw new Error(`${label}: unknown category "${id}"`)
    return category
  }

  /** Alias-aware lookup that reports unknown values instead of defaulting. */
  lookup(value?: string): CategoryDefinition | undefined {
    const key = slugifyCategory(value ?? '')
    return key ? this.byAlias.get(key) : undefined
  }

  /** Lenient lookup for imported registries: aliases map to a canonical category, else `other`. */
  resolve(value?: string): CategoryDefinition {
    return this.lookup(value) ?? this.byID.get(DEFAULT_CATEGORY_ID)!
  }

  snapshotCategory(id: string): SnapshotCategory {
    const category = this.require(id, 'Category table')
    return { id: category.id, name: { ...category.name }, order: category.order }
  }
}

export function parseCategoryTable(raw: unknown): CategoryTable {
  const parsed = categoryTableSchema.parse(raw)
  const categories = [...parsed.categories].sort((a, b) => a.order - b.order || compareCanonicalText(a.id, b.id))
  return new CategoryTable(categories)
}

export function defaultCategoryTable(): CategoryTable {
  return new CategoryTable([{ id: DEFAULT_CATEGORY_ID, name: { en: 'Other' }, aliases: [], order: 100_000 }])
}

export async function loadCategoryTable(projectRoot: string): Promise<CategoryTable> {
  const target = path.join(projectRoot, 'registries', CATEGORY_TABLE_FILE)
  let content: string
  try {
    content = await readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultCategoryTable()
    throw error
  }
  try {
    return parseCategoryTable(parseYaml(content))
  } catch (error) {
    throw new Error(`registries/${CATEGORY_TABLE_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function mergeSnapshotCategories(groups: SnapshotCategory[][]): SnapshotCategory[] {
  const merged = new Map<string, SnapshotCategory>()
  for (const group of groups) {
    for (const category of group) {
      if (!merged.has(category.id)) merged.set(category.id, { ...category, name: { ...category.name } })
    }
  }
  return [...merged.values()].sort((a, b) => a.order - b.order || compareCanonicalText(a.id, b.id))
}
