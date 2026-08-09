import { describe, expect, test } from 'bun:test'
import type { SkillRegistryDefinition } from '../types'
import {
  parseRegistryReleaseLock,
  serializeRegistryReleaseLock,
} from './release-lock'

const definition: SkillRegistryDefinition = {
  schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10,
  adapter: { type: 'skill_directory' }, source: { type: 'local', path: 'skills' },
}

describe('Registry release lock', () => {
  test('accepts only a canonical Snapshot revision lock', () => {
    const bytes = serializeRegistryReleaseLock({ snapshot_revision: 'a'.repeat(64) })
    expect(parseRegistryReleaseLock(bytes, definition)).toEqual({ snapshot_revision: 'a'.repeat(64) })
    expect(() => parseRegistryReleaseLock(
      new TextEncoder().encode('{"snapshot_revision":"' + 'a'.repeat(64) + '","extra":true}\n'),
      definition,
    )).toThrow('valid snapshot_revision')
  })
})
