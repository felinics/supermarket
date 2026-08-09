import { defineHandler, HTTPError } from 'nitro'
import { getRouterParam } from 'h3'
import { getRuntimeSkillRegistryStore } from '#server/services/skill-registry'
import { immutableArtifactResponse } from '#server/services/immutable-artifact-response'

export default defineHandler(async (event) => {
  const digest = getRouterParam(event, 'digest')!
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new HTTPError('Invalid Skill icon digest', { statusCode: 400 })
  const store = await getRuntimeSkillRegistryStore(event)
  const skillIcon = store.getImageStream
    ? await store.getImageStream(digest)
    : await store.getImage(digest).then((value) => value && ({ descriptor: value.descriptor, body: value.bytes }))
  if (!skillIcon) throw new HTTPError(`Skill icon "${digest}" not found`, { statusCode: 404 })
  return immutableArtifactResponse(event, skillIcon, {
    headers: {
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
})
