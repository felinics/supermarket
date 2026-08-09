import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam, getValidatedQuery } from 'h3'
import { parseSkillPackageQuery, requireRegistryID } from '#server/services/skill-registry-query'
import { getRegistrySkillPackages } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const id = requireRegistryID(getRouterParam(event, 'id')!)
  const result = await getRegistrySkillPackages(
    event,
    id,
    await getValidatedQuery(event, (query: Record<string, unknown>) => parseSkillPackageQuery(query, id)),
  )
  if (!result) throw new HTTPError(`Registry "${id}" not found`, { statusCode: 404 })
  return result
})
