import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { requireRegistryID } from '#server/services/skill-registry-query'
import { getSkillRegistryDetails } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const id = requireRegistryID(getRouterParam(event, 'id')!)
  const registry = await getSkillRegistryDetails(event, id)
  if (!registry) throw new HTTPError(`Registry "${id}" not found`, { statusCode: 404 })
  return registry
})
