import { defineHandler } from 'nitro'
import { getValidatedQuery } from 'h3'
import { parseSkillRegistryQuery } from '#server/services/skill-registry-query'
import { getCatalogSkills } from '#server/services/skill-registry'

export default defineHandler(async (event) => getCatalogSkills(event, await getValidatedQuery(event, parseSkillRegistryQuery)))
