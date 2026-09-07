import { defineHandler, HTTPError } from 'nitro'
import { getQuery, setResponseHeader } from 'h3'
import { getDependencyRegistryStore } from '#server/services/dependency-registry'
import { positiveIntegerQuery, scalarQuery } from '#server/services/query'

export default defineHandler(async (event) => {
  const query = getQuery(event)
  const page = positiveIntegerQuery(scalarQuery(query, 'page'), 'page') ?? 1
  const limit = positiveIntegerQuery(scalarQuery(query, 'limit'), 'limit', 256) ?? 50
  const registry = scalarQuery(query, 'registry')
  const category = scalarQuery(query, 'category')
  if (category && !['agent', 'runtime', 'tool'].includes(category)) throw new HTTPError('Invalid dependency category', { statusCode: 400 })
  const current = await (await getDependencyRegistryStore(event)).current()
  const q = (scalarQuery(query, 'q') ?? '').toLowerCase()
  const dependencies = (current?.snapshot.dependencies ?? []).filter((item) =>
    (!registry || registry === item.registry_id)
    && (!category || category === item.manifest.category)
    && JSON.stringify([item.dependency_id, item.manifest.name, item.manifest.description, item.manifest.translations]).toLowerCase().includes(q))
  setResponseHeader(event, 'cache-control', 'no-cache')
  return { total: dependencies.length, page, limit, revision: current?.revision,
    data: dependencies.slice((page - 1) * limit, page * limit) }
})
