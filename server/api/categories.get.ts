import { defineHandler, HTTPError } from 'nitro'
import { getQuery } from 'h3'
import { requireRegistryID } from '#server/services/skill-registry-query'
import { scalarQuery } from '#server/services/query'
import { getPackageCategories } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const registryValue = scalarQuery(getQuery(event) as Record<string, unknown>, 'registry')
  const registryID = registryValue != null ? requireRegistryID(registryValue) : undefined
  const categories = await getPackageCategories(event, registryID)
  if (!categories) throw new HTTPError(`Registry "${registryID}" not found`, { statusCode: 404 })
  return { data: categories }
})
