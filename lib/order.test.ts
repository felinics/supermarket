import { describe, expect, test } from 'bun:test'
import { compareCanonicalText } from './order'

describe('canonical release ordering', () => {
  test('uses lexical code-unit order rather than locale collation', () => {
    expect(['z', 'ä', 'a'].sort(compareCanonicalText)).toEqual(['a', 'z', 'ä'])
  })
})
