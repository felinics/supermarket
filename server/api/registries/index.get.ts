import { defineHandler } from 'nitro'
import { getSkillRegistrySummaries } from '#server/services/skill-registry'

export default defineHandler(async (event) => ({ data: await getSkillRegistrySummaries(event) }))
