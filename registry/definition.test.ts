import { describe, expect, test } from 'bun:test'
import {
  assertIdentifier,
  assertRegistryComponentID,
  assertRegistryID,
  parseSkillRegistryDefinition,
  safeRelativePath,
  skillInstallID,
} from './definition'

describe('Skill Registry definitions', () => {
  test('enforces identifiers that Memoh preserves without rewriting', () => {
    expect(assertIdentifier('build-web_apps')).toBe('build-web_apps')
    for (const value of ['Foo', 'foo.bar', '.foo', 'foo..bar', 'foo/bar']) {
      expect(() => assertIdentifier(value)).toThrow('Invalid ID')
    }
    expect(assertRegistryID('openai.api')).toBe('openai.api')
    expect(assertRegistryComponentID('build.web_apps')).toBe('build.web_apps')
    expect(skillInstallID('openai.api', 'documents.v2', 'pdf.reader')).toBe(
      'openai.api+documents.v2+pdf.reader',
    )
    for (const value of ['Foo', '.foo', 'foo..bar', 'foo.', 'foo+bar', 'foo/bar', 'CON', 'nul.txt', 'x'.repeat(129)]) {
      expect(() => assertRegistryComponentID(value)).toThrow('Invalid Registry component ID')
    }
    expect(() => assertRegistryID('user')).toThrow('Reserved registry ID')
  })

  test('parses sources', () => {
    const definition = parseSkillRegistryDefinition({
      schema_version: '1', id: 'example', name: 'Example',
      adapter: { type: 'codex_marketplace_skills', catalog_path: 'marketplace.json' },
      source: {
        type: 'git',
        url: 'https://example.test/skills.git',
        revision: 'a'.repeat(40),
        tracking_ref: 'main',
      },
    })
    expect(definition.source).toMatchObject({ revision: 'a'.repeat(40), tracking_ref: 'main' })
    for (const invalid of [
      { enabled: 'false' },
      { priority: '100' },
      { priority: 1.5 },
    ]) {
      expect(() => parseSkillRegistryDefinition({
        schema_version: '1', id: 'example', name: 'Example', ...invalid,
        adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
      })).toThrow()
    }
  })

  test('rejects old adapter syntax, unknown adapters and unsafe paths', () => {
    expect(safeRelativePath('./skills/')).toBe('skills')
    expect(() => safeRelativePath('../private')).toThrow('escapes its source')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'unknown' }, source: { type: 'local', path: 'skills' },
    })).toThrow('unsupported adapter')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: 'skill_directory',
      source: { type: 'local', path: 'skills' },
    })).toThrow('adapter must be an object')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad',
      adapter: { type: 'codex_marketplace_skills' },
      source: { type: 'local', path: 'skills' },
    })).toThrow('adapter.catalog_path is required')
    for (const field of ['defaults', 'package_overrides', 'skill_overrides', 'taxonomy']) {
      expect(() => parseSkillRegistryDefinition({
        schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' },
        source: { type: 'local', path: 'skills' },
        [field]: {},
      })).toThrow(`unsupported Registry field ${field}`)
    }
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' }, source: { type: 'local' },
    })).toThrow('local source.path is required')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' },
      source: { type: 'local', path: 'skills', pathh: 'ignored' },
    })).toThrow('local source contains unsupported field pathh')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' },
      source: {
        type: 'git',
        url: 'https://example.test/skills.git',
        revision: 'a'.repeat(40),
        branch: 'main',
      },
    })).toThrow('git source contains unsupported field branch')
    expect(() => parseSkillRegistryDefinition({
      schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' },
      source: { type: 'git', url: 'https://example.test/skills.git', revision: 'main' },
    })).toThrow('full commit hash')
    for (const url of ['ssh://git@example.test/skills.git', 'git@example.test:skills.git', 'http://example.test/skills.git']) {
      expect(() => parseSkillRegistryDefinition({
        schema_version: '1', id: 'bad', name: 'Bad', adapter: { type: 'skill_directory' },
        source: { type: 'git', url, revision: 'a'.repeat(40) },
      })).toThrow('must use HTTPS')
    }
  })
})
