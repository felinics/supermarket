import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { getRuntimeSkillRegistryStore } from '#server/services/skill-registry'
import { immutableArtifactResponse } from '#server/services/immutable-artifact-response'

export default defineHandler(async (event) => {
  const digest = getRouterParam(event, 'digest')!
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new HTTPError('Invalid artifact digest', { statusCode: 400 })
  const store = await getRuntimeSkillRegistryStore(event)
  const artifact = store.getArtifactStream
    ? await store.getArtifactStream(digest)
    : await store.getArtifact(digest).then((value) => value && ({ descriptor: value.descriptor, body: value.bytes }))
  if (!artifact) throw new HTTPError(`Artifact "${digest}" not found`, { statusCode: 404 })
  return immutableArtifactResponse(event, artifact, { filename: `${digest}.tar.gz` })
})
