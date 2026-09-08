import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { assertDigest } from '#lib/digest'
import { requireRegistryComponentID } from '#server/services/skill-registry-query'
import { getDependencyRegistryStore } from '#server/services/dependency-registry'
import { immutableArtifactResponse } from '#server/services/immutable-artifact-response'

export default defineHandler(async (event) => {
  if (getRouterParam(event, 'id') !== 'memoh') throw new HTTPError('Dependency registry not found', { statusCode: 404 })
  const id = requireRegistryComponentID(getRouterParam(event, 'dependencyId')!, 'dependency ID')
  let revision: string
  try { revision = assertDigest(getRouterParam(event, 'revision')!) }
  catch { throw new HTTPError('Invalid dependency revision', { statusCode: 400 }) }
  const result = await (await getDependencyRegistryStore(event)).release(id, revision)
  if (!result) throw new HTTPError('Dependency release not found', { statusCode: 404 })
  return immutableArtifactResponse(event, {
    descriptor: { digest: revision, size: result.bytes.length, content_type: 'application/json; charset=utf-8' }, body: result.bytes,
  })
})
