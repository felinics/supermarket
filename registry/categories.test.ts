import { describe, expect, test } from 'bun:test'
import { defaultCategoryTable, mergeSnapshotCategories, parseCategoryTable, slugifyCategory } from './categories'

describe('Category table', () => {
  const table = parseCategoryTable({ schema_version: '1', categories: [
    { id: 'developer-tools', name: { en: 'Developer Tools', zh: '开发工具' }, aliases: ['devtools'], order: 40 },
    { id: 'education-research', name: { en: 'Education & Research' }, aliases: ['Scientific Research'], order: 90 },
    { id: 'other', name: { en: 'Other' }, order: 1000 },
  ] })

  test('resolves IDs, English names and aliases leniently', () => {
    expect(table.resolve('developer-tools').id).toBe('developer-tools')
    expect(table.resolve('Developer Tools').id).toBe('developer-tools')
    expect(table.resolve('DEVTOOLS').id).toBe('developer-tools')
    expect(table.resolve('Scientific Research').id).toBe('education-research')
    expect(table.resolve('Education & Research').id).toBe('education-research')
    expect(table.resolve('Unknown').id).toBe('other')
    expect(table.resolve(undefined).id).toBe('other')
    expect(table.lookup('Unknown')).toBeUndefined()
    expect(slugifyCategory('Data & Analytics')).toBe('data-analytics')
  })

  test('requires known IDs for reviewed registries', () => {
    expect(() => table.require('devtools', 'memoh/demo')).toThrow('unknown category "devtools"')
    expect(table.require('developer-tools', 'memoh/demo').name.zh).toBe('开发工具')
    expect(table.snapshotCategory('other')).toEqual({ id: 'other', name: { en: 'Other' }, order: 1000 })
  })

  test('rejects tables without other, duplicate IDs or conflicting aliases', () => {
    expect(() => parseCategoryTable({ schema_version: '1', categories: [{ id: 'a', name: { en: 'A' } }] }))
      .toThrow('must define the "other" category')
    expect(() => parseCategoryTable({ schema_version: '1', categories: [
      { id: 'other', name: { en: 'Other' } }, { id: 'other', name: { en: 'Again' } },
    ] })).toThrow('Duplicate category ID')
    expect(() => parseCategoryTable({ schema_version: '1', categories: [
      { id: 'a', name: { en: 'Alpha' }, aliases: ['Shared'] }, { id: 'other', name: { en: 'Other' }, aliases: ['shared'] },
    ] })).toThrow('claimed by both')
    expect(() => parseCategoryTable({ schema_version: '1', categories: [
      { id: 'other', name: { en: 'Other' }, extra: true },
    ] })).toThrow()
    expect(defaultCategoryTable().categories.map((category) => category.id)).toEqual(['other'])
  })

  test('merges Snapshot categories in display order without duplicates', () => {
    expect(mergeSnapshotCategories([
      [{ id: 'other', name: { en: 'Other' }, order: 1000 }],
      [{ id: 'developer-tools', name: { en: 'Developer Tools' }, order: 40 }, { id: 'other', name: { en: 'Else' }, order: 1000 }],
    ])).toEqual([
      { id: 'developer-tools', name: { en: 'Developer Tools' }, order: 40 },
      { id: 'other', name: { en: 'Other' }, order: 1000 },
    ])
  })
})
