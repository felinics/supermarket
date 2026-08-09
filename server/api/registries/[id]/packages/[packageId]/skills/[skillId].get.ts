import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { requireRegistryComponentID, requireRegistryID } from '#server/services/skill-registry-query'
import { getCatalogSkill, publicCatalogSkill } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const registryID = requireRegistryID(getRouterParam(event, 'id')!)
  const packageID = requireRegistryComponentID(getRouterParam(event, 'packageId')!, 'package ID')
  const skillID = requireRegistryComponentID(getRouterParam(event, 'skillId')!, 'skill ID')
  const skill = await getCatalogSkill(event, registryID, packageID, skillID)
  if (!skill) throw new HTTPError(`Skill "${registryID}/${packageID}/${skillID}" not found`, { statusCode: 404 })
  return publicCatalogSkill(skill)
})
