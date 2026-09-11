import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam, getValidatedQuery } from 'h3'
import { parseAppQuery, requireRegistryID } from '#server/services/skill-registry-query'
import { getRegistryApps } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const id = requireRegistryID(getRouterParam(event, 'id')!)
  const result = await getRegistryApps(
    event,
    id,
    await getValidatedQuery(event, (query: Record<string, unknown>) => parseAppQuery(query, id)),
  )
  if (!result) throw new HTTPError(`Registry "${id}" not found`, { statusCode: 404 })
  return result
})
