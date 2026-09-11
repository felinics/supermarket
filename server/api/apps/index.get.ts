import { defineHandler } from 'nitro'
import { getValidatedQuery } from 'h3'
import { parseAppQuery } from '#server/services/skill-registry-query'
import { getApps } from '#server/services/skill-registry'

export default defineHandler(async (event) => getApps(event, await getValidatedQuery(event, parseAppQuery)))
