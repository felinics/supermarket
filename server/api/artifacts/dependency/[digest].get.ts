import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { assertDigest } from '#lib/digest'
import { getDependencyRegistryStore } from '#server/services/dependency-registry'
import { immutableArtifactResponse } from '#server/services/immutable-artifact-response'

export default defineHandler(async (event) => {
  let digest: string
  try { digest = assertDigest(getRouterParam(event, 'digest')!) }
  catch { throw new HTTPError('Invalid dependency artifact digest', { statusCode: 400 }) }
  const artifact = await (await getDependencyRegistryStore(event)).artifact(digest)
  if (!artifact) throw new HTTPError('Dependency artifact not found', { statusCode: 404 })
  return immutableArtifactResponse(event, artifact, { filename: `${digest}.tar.gz` })
})
