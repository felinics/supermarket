import { defineHandler, HTTPError } from 'nitro'
import { getValidatedQuery, getRouterParam } from 'h3'
import { parseSkillRegistryQuery, requireRegistryID } from '#server/services/skill-registry-query'
import { getRegistryCatalogSkills } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const id = requireRegistryID(getRouterParam(event, 'id')!)
  const result = await getRegistryCatalogSkills(
    event,
    id,
    await getValidatedQuery(event, (query: Record<string, unknown>) => parseSkillRegistryQuery(query, id)),
  )
  if (!result) throw new HTTPError(`Registry "${id}" not found`, { statusCode: 404 })
  return result
})
