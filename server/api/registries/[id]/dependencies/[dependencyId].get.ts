import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam, setResponseHeader } from 'h3'
import { getDependencyRegistryStore } from '#server/services/dependency-registry'

export default defineHandler(async (event) => {
  if (getRouterParam(event, 'id') !== 'memoh') throw new HTTPError('Dependency registry not found', { statusCode: 404 })
  const current = await (await getDependencyRegistryStore(event)).current()
  const dependency = current?.snapshot.dependencies.find((item) => item.dependency_id === getRouterParam(event, 'dependencyId'))
  if (!dependency) throw new HTTPError('Dependency not found', { statusCode: 404 })
  setResponseHeader(event, 'cache-control', 'no-cache')
  return dependency
})
