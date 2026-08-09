import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { requireRegistryID } from '#server/services/skill-registry-query'
import { getRegistrySkillCategories } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const id = requireRegistryID(getRouterParam(event, 'id')!)
  const categories = await getRegistrySkillCategories(event, id)
  if (!categories) throw new HTTPError(`Registry "${id}" not found`, { statusCode: 404 })
  return { data: categories }
})
