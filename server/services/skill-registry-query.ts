import { HTTPError } from 'nitro'
import * as z from 'zod/mini'
import type { SkillCatalogSearchOptions } from '#registry/catalog'
import type { SkillPackageSearchOptions } from '#registry/packages'
import { assertIdentifier, assertRegistryComponentID, assertRegistryID } from '#registry/definition'
import { positiveIntegerQuery, scalarQuery } from './query'

function badRequest(message: string): never {
  throw new HTTPError(message, { statusCode: 400 })
}

export function requireIdentifier(value: string, label: string) {
  try {
    return assertIdentifier(value, label)
  } catch {
    return badRequest(`Invalid ${label}: ${value}`)
  }
}

export function requireRegistryComponentID(value: string, label: string) {
  try {
    return assertRegistryComponentID(value, label)
  } catch {
    return badRequest(`Invalid ${label}: ${value}`)
  }
}

export function requireRegistryID(value: string) {
  try {
    return assertRegistryID(value)
  } catch {
    return badRequest(`Invalid registry ID: ${value}`)
  }
}

export function parseSkillRegistryQuery(query: Record<string, unknown>, registry?: string): SkillCatalogSearchOptions {
  const registryValue = registry ?? scalarQuery(query, 'registry')
  const packageValue = scalarQuery(query, 'package')
  const category = scalarQuery(query, 'category')
  const sortValue = scalarQuery(query, 'sort')
  const sort = z.optional(z.enum(['relevance', 'name', 'registry', 'package']))
  if (!sort.safeParse(sortValue).success) badRequest(`Unsupported sort: ${sortValue}`)
  return {
    registry: registryValue != null ? requireRegistryID(registryValue) : undefined,
    q: scalarQuery(query, 'q'),
    package: packageValue != null ? requireRegistryComponentID(packageValue, 'package ID') : undefined,
    category: category != null ? requireIdentifier(category.toLowerCase(), 'category ID') : undefined,
    tag: scalarQuery(query, 'tag'),
    page: positiveIntegerQuery(scalarQuery(query, 'page'), 'page'),
    limit: positiveIntegerQuery(scalarQuery(query, 'limit'), 'limit', 100),
    sort: sortValue as SkillCatalogSearchOptions['sort'],
  }
}

export function parseSkillPackageQuery(query: Record<string, unknown>, registry?: string): SkillPackageSearchOptions {
  const registryValue = registry ?? scalarQuery(query, 'registry')
  const category = scalarQuery(query, 'category')
  const sortValue = scalarQuery(query, 'sort')
  const sort = z.optional(z.enum(['relevance', 'name', 'registry']))
  if (!sort.safeParse(sortValue).success) badRequest(`Unsupported sort: ${sortValue}`)
  return {
    registry: registryValue != null ? requireRegistryID(registryValue) : undefined,
    q: scalarQuery(query, 'q'),
    category: category != null ? requireIdentifier(category.toLowerCase(), 'category ID') : undefined,
    tag: scalarQuery(query, 'tag'),
    page: positiveIntegerQuery(scalarQuery(query, 'page'), 'page'),
    limit: positiveIntegerQuery(scalarQuery(query, 'limit'), 'limit', 100),
    sort: sortValue as SkillPackageSearchOptions['sort'],
  }
}
