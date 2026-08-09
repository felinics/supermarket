import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { requireRegistryComponentID, requireRegistryID } from '#server/services/skill-registry-query'
import { getCurrentSkillPackage } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const registryID = requireRegistryID(getRouterParam(event, 'id')!)
  const packageID = requireRegistryComponentID(getRouterParam(event, 'packageId')!, 'package ID')
  const descriptor = await getCurrentSkillPackage(event, registryID, packageID)
  if (!descriptor) throw new HTTPError(`Package "${registryID}/${packageID}" not found`, { statusCode: 404 })
  return {
    ...descriptor,
    release_url: `/api/registries/${registryID}/packages/${packageID}/releases/${descriptor.revision}`,
  }
})
