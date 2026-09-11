import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { requireRegistryComponentID, requireRegistryID } from '#server/services/skill-registry-query'
import { getCurrentApp } from '#server/services/skill-registry'

export default defineHandler(async (event) => {
  const registryID = requireRegistryID(getRouterParam(event, 'id')!)
  const appID = requireRegistryComponentID(getRouterParam(event, 'appId')!, 'app ID')
  const descriptor = await getCurrentApp(event, registryID, appID)
  if (!descriptor) throw new HTTPError(`App "${registryID}/${appID}" not found`, { statusCode: 404 })
  return {
    ...descriptor,
    release_url: `/api/registries/${registryID}/apps/${appID}/releases/${descriptor.revision}`,
  }
})
