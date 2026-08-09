import { defineHandler } from 'nitro'
import { getValidatedQuery } from 'h3'
import { parseSkillPackageQuery } from '#server/services/skill-registry-query'
import { getSkillPackages } from '#server/services/skill-registry'

export default defineHandler(async (event) => getSkillPackages(event, await getValidatedQuery(event, parseSkillPackageQuery)))
