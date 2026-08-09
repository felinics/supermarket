import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { packTar } from 'modern-tar'
import { createTar, gzip } from '#lib/archive'
import { packageSkill } from '#registry/artifacts/build'
import {
  extractSkillArchive,
  parseGzipTarArchive,
  parseTarArchive,
  validateSkillArchive,
} from './archive'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('Skill Registry client archives', () => {
  test('packages the extraction metadata required by Memoh', async () => {
    const files = {
      'SKILL.md': { bytes: new TextEncoder().encode('---\nname: metadata\n---\n'), mode: 0o644 as const },
      'scripts/run.sh': { bytes: new TextEncoder().encode('#!/bin/sh\n'), mode: 0o755 as const },
    }
    const archive = await createTar(files, '')
    const packaged = await packageSkill(files)

    expect(packaged.uncompressedSize).toBe(
      files['SKILL.md'].bytes.length + files['scripts/run.sh'].bytes.length,
    )
    expect(packaged.archiveSize).toBe(archive.length)
    expect(packaged.fileCount).toBe(2)
    expect(packaged.bytes).toEqual(await gzip(archive))
  })

  test('creates archives with a canonical gzip header', async () => {
    const files = {
      'SKILL.md': new TextEncoder().encode('---\nname: deterministic\n---\n'),
      'scripts/run.sh': { bytes: new TextEncoder().encode('#!/bin/sh\n'), mode: 0o755 as const },
    }
    const first = await createTar(files, '')
    const second = await createTar(files, '')
    expect(second).toEqual(first)
    const compressed = await gzip(second)
    expect(compressed).toEqual(await gzip(first))
    expect([...compressed.slice(0, 10)]).toEqual([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff])
  })

  test('round-trips long USTAR paths and installs a namespaced Skill', async () => {
    const installID = 'openai--documents--pdf'
    const longPath = `references/${'nested/'.repeat(12)}guide.md`
    const compressed = await gzip(await createTar({
      'SKILL.md': new TextEncoder().encode('---\nname: pdf\n---\n'),
      [longPath]: new TextEncoder().encode('guide'),
      'references/note.txt': new TextEncoder().encode('spacing'),
      'scripts/run.sh': { bytes: new TextEncoder().encode('#!/bin/sh\n'), mode: 0o755 },
    }, ''))
    const files = await parseGzipTarArchive(compressed)
    validateSkillArchive(files)
    expect(files.has('SKILL.md')).toBe(true)
    expect([...files.keys()].some((name) => name.startsWith(`${installID}/`))).toBe(false)
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-client-install-'))
    roots.push(root)
    const installed = await extractSkillArchive(files, root, installID)
    expect(await readFile(path.join(installed, longPath), 'utf8')).toBe('guide')
    expect(await readFile(path.join(installed, 'references/note.txt'), 'utf8')).toBe('spacing')
    expect((await stat(path.join(installed, 'scripts/run.sh'))).mode & 0o777).toBe(0o755)
  })

  test('rejects install identities that escape the destination', async () => {
    const files = await parseTarArchive(await createTar({
      'SKILL.md': new TextEncoder().encode('---\nname: shared\n---\n'),
    }, ''))
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-client-install-escape-'))
    roots.push(root)

    await expect(extractSkillArchive(files, root, '../escaped')).rejects.toThrow('escapes destination')
    await expect(extractSkillArchive(files, root, path.join(root, 'absolute'))).rejects.toThrow('escapes destination')
  })

  test('rejects traversal, unsupported entry types, conflicts and decompression bombs', async () => {
    await expect(createTar({ '../private': new Uint8Array() }, 'skill')).rejects.toThrow('Unsafe tar path')
    await expect(createTar({ 'references\\private': new Uint8Array() }, 'skill')).rejects.toThrow('Unsafe tar path')
    await expect(createTar({ 'references/note ': new Uint8Array() }, 'skill')).rejects.toThrow('Unsafe tar path')
    await expect(createTar({ 'scripts/NUL.txt': new Uint8Array() }, 'skill')).rejects.toThrow('Unsafe tar path')
    await expect(createTar({ 'scripts/Foo': new Uint8Array(), 'scripts/foo': new Uint8Array() }, ''))
      .rejects.toThrow('Duplicate tar path')
    await expect(createTar({
      'references/caf\u00e9.md': new Uint8Array(),
      'references/cafe\u0301.md': new Uint8Array(),
    }, '')).rejects.toThrow('Duplicate tar path')
    await expect(createTar({ 'file': new Uint8Array(), 'file/child': new Uint8Array() }, ''))
      .rejects.toThrow('Conflicting tar path')
    const traversal = await packTar([{
      header: { name: '../private', size: 1, type: 'file' },
      body: new Uint8Array([1]),
    }])
    await expect(parseTarArchive(traversal)).rejects.toThrow('Unsafe archive path')
    const windowsDevice = await packTar([{
      header: { name: 'references/CON', size: 1, type: 'file' },
      body: new Uint8Array([1]),
    }])
    await expect(parseTarArchive(windowsDevice)).rejects.toThrow('Unsafe archive path')
    const symlink = await packTar([{
      header: { name: 'link', size: 0, type: 'symlink', linkname: 'SKILL.md' },
    }])
    await expect(parseTarArchive(symlink)).rejects.toThrow('Unsupported archive entry type')
    const tar = await createTar({ 'SKILL.md': new Uint8Array() }, '')
    tar[156] = 0x32
    await expect(parseTarArchive(tar)).rejects.toThrow(/checksum|entry type/i)
    const conflict = await packTar([{
      header: { name: 'file', size: 1, type: 'file' },
      body: new Uint8Array([1]),
    }, {
      header: { name: 'file/child', size: 1, type: 'file' },
      body: new Uint8Array([2]),
    }])
    await expect(parseTarArchive(conflict)).rejects.toThrow(/conflicting archive path/i)
    const caseConflict = await packTar([{
      header: { name: 'scripts/Run.sh', size: 1, type: 'file' },
      body: new Uint8Array([1]),
    }, {
      header: { name: 'scripts/run.sh', size: 1, type: 'file' },
      body: new Uint8Array([2]),
    }])
    await expect(parseTarArchive(caseConflict)).rejects.toThrow('Duplicate archive path')
    const compressed = await gzip(new Uint8Array(1024))
    await expect(parseGzipTarArchive(compressed, 100)).rejects.toThrow('decompression limit')
  })

  test('serializes concurrent installs for the same identity', async () => {
    const installID = 'registry+package+skill'
    const files = await parseTarArchive(await createTar({
      'SKILL.md': new TextEncoder().encode('---\nname: skill\n---\n'),
    }, ''))
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-client-concurrent-install-'))
    roots.push(root)
    const results = await Promise.allSettled([
      extractSkillArchive(files, root, installID), extractSkillArchive(files, root, installID),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})
