import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSkillRegistryDefinitionResults } from './repository'

describe('Registry definition repository', () => {
  test('loads valid definitions alongside a malformed file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'registry-definition-results-'))
    try {
      await mkdir(path.join(root, 'registries/valid'), { recursive: true })
      await mkdir(path.join(root, 'registries/broken'), { recursive: true })
      await writeFile(path.join(root, 'registries/valid/registry.yaml'), `schema_version: "1"\nid: valid\nname: Valid\nadapter:\n  type: skill_directory\nsource:\n  type: local\n  path: skills\n`)
      await writeFile(path.join(root, 'registries/broken/registry.yaml'), 'schema_version: [')
      const result = await loadSkillRegistryDefinitionResults(root)
      expect(result.definitions.map((item) => item.id)).toEqual(['valid'])
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]?.registry).toBe('broken')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
