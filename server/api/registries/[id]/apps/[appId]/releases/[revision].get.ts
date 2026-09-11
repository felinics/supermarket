import { defineHandler, HTTPError } from 'nitro'
import { getHeader, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { assertDigest } from '#registry/storage/validation'
import { requireRegistryComponentID, requireRegistryID } from '#server/services/skill-registry-query'
import { getAppRelease } from '#server/services/skill-registry'
import { serializeAppRelease } from '#registry/snapshot'

export default defineHandler(async (event) => {
  const registryID = requireRegistryID(getRouterParam(event, 'id')!)
  const appID = requireRegistryComponentID(getRouterParam(event, 'appId')!, 'app ID')
  let revision: string
  try {
    revision = assertDigest(getRouterParam(event, 'revision')!)
  } catch {
    throw new HTTPError('Invalid App release revision', { statusCode: 400 })
  }
  const release = await getAppRelease(event, registryID, appID, revision)
  if (!release) {
    throw new HTTPError(`App release "${registryID}/${appID}/${revision}" not found`, { statusCode: 404 })
  }

  const bytes = serializeAppRelease(release)
  const etag = `"${revision}:${appID}"`
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'content-length', String(bytes.length))
  setResponseHeader(event, 'etag', etag)
  setResponseHeader(event, 'x-content-sha256', revision)
  setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  const validators = (getHeader(event, 'if-none-match') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
  if (validators.includes('*') || validators.includes(etag)) {
    setResponseStatus(event, 304)
    return null
  }
  return bytes
})
