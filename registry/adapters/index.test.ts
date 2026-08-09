import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_SKILL_IMAGE_BYTES, type SkillRegistryAdapter, type SkillRegistryDefinition } from '../types'
import { readDirectoryFiles, readFileBounded } from '../filesystem'
import { parsePackagePostinstall } from '../package-manifest'
import { buildSkillCandidates } from './index'
import { detectSkillImageContentType } from './codex-marketplace'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function writeSkill(root: string, relativePath: string, name: string, extra = '') {
  const directory = path.join(root, relativePath)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\nmetadata:\n  tags: [test]\n---\n\n# ${name}\n`)
  if (extra) await writeFile(path.join(directory, 'reference.md'), extra)
}

function definition(adapterType: SkillRegistryAdapter['type']): SkillRegistryDefinition {
  const adapter: SkillRegistryAdapter = adapterType === 'codex_marketplace_skills'
    ? { type: adapterType, catalog_path: 'marketplace.json' }
    : { type: adapterType }
  return {
    schema_version: '1', id: 'example', name: 'Example', enabled: true, priority: 10, adapter,
    source: { type: 'local', path: 'source' },
  }
}

describe('Skill Registry adapters', () => {
  test('imports standalone skill directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'standalone-skills-'))
    roots.push(root)
    await writeSkill(root, 'alpha', 'Alpha', 'reference')
    await writeFile(path.join(root, 'alpha/run.sh'), '#!/bin/sh\n')
    await chmod(path.join(root, 'alpha/run.sh'), 0o755)
    await mkdir(path.join(root, 'notes'))
    const result = await buildSkillCandidates({ definition: definition('skill_directory'), sourceRoot: root })
    expect(result.diagnostics).toEqual([])
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      package_id: 'alpha', skill_id: 'alpha', install_id: 'example+alpha+alpha',
      name: 'Alpha', description: 'Alpha description', tags: ['test'],
    })
    expect(Object.keys(result.skills[0]!.files).sort()).toEqual(['SKILL.md', 'reference.md', 'run.sh'])
    expect(result.skills[0]!.files['run.sh']?.mode).toBe(0o755)
  })

  test('imports namespaced skills from package directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'package-skills-'))
    roots.push(root)
    await writeSkill(root, 'notion/skills/search', 'Search')
    await writeSkill(root, 'notion/skills/write', 'Write')
    await writeSkill(root, 'github/skills/review', 'Review')
    await writeFile(path.join(root, 'notion/package.yaml'), `schema_version: "1"
postinstall:
  - command: npm
    args: [install, --global, opencli]
`)

    const result = await buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.packageMetadata.get('notion')).toEqual({
      postinstall: [{ command: 'npm', args: ['install', '--global', 'opencli'] }],
    })
    expect(result.packageMetadata.has('github')).toBe(false)
    expect(result.skills.map((skill) => ({
      package_id: skill.package_id,
      skill_id: skill.skill_id,
      install_id: skill.install_id,
      source_path: skill.source_path,
    }))).toEqual([
      {
        package_id: 'github', skill_id: 'review', install_id: 'example+github+review',
        source_path: 'github/skills/review',
      },
      {
        package_id: 'notion', skill_id: 'search', install_id: 'example+notion+search',
        source_path: 'notion/skills/search',
      },
      {
        package_id: 'notion', skill_id: 'write', install_id: 'example+notion+write',
        source_path: 'notion/skills/write',
      },
    ])
  })

  test('rejects malformed package directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-package-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'empty/skills'), { recursive: true })

    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('package contains no skills')
  })

  test('rejects unsafe or unsupported Memoh Package manifests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-package-manifest-'))
    roots.push(root)
    await writeSkill(root, 'tools/skills/tools', 'Tools')
    const manifest = path.join(root, 'tools/package.yaml')

    await writeFile(manifest, `schema_version: "1"
postinstall:
  - command: sh
    args: [-c, echo unsafe]
`)
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('supported executable name')

    await writeFile(manifest, `schema_version: "1"
postinstall:
  - command: npm
    args: [install, opencli]
    shell: true
`)
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('unsupported field shell')

    expect(() => parsePackagePostinstall([
      { command: 'npm', args: ['\uD800'] },
    ], 'postinstall')).toThrow('unpaired UTF-16 surrogate')
  })

  test('rejects Memoh Package manifests that escape through symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'package-manifest-symlink-source-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'package-manifest-symlink-outside-'))
    roots.push(root, outside)
    await writeSkill(root, 'tools/skills/tools', 'Tools')
    await writeFile(path.join(outside, 'package.yaml'), 'schema_version: "1"\n')
    await symlink(path.join(outside, 'package.yaml'), path.join(root, 'tools/package.yaml'))

    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('escapes source through a symlink')
  })

  test('imports pure Skill Packages and rejects mixed Codex Packages', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'packages/usable/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'packages/blocked/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'usable', category: 'Developer Tools', source: { source: 'local', path: 'packages/usable' } },
      { name: 'blocked', source: { source: 'local', path: 'packages/blocked' } },
    ] }))
    await writeFile(path.join(root, 'packages/usable/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'usable', author: { name: 'OpenAI' }, keywords: ['codex'], skills: './skills',
      interface: {
        composerIcon: './assets/icon.svg', logo: './assets/logo.png', brandColor: '#0b7285',
      },
    }))
    await mkdir(path.join(root, 'packages/usable/assets'), { recursive: true })
    await writeFile(path.join(root, 'packages/usable/assets/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(path.join(root, 'packages/usable/assets/logo.png'), new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
    await writeFile(path.join(root, 'packages/blocked/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'blocked', skills: './skills', apps: ['./app'],
      mcpServers: { example: { url: 'https://example.test' } }, hooks: { sessionStart: ['./hook'] },
    }))
    await writeSkill(root, 'packages/usable/skills/demo', 'Demo')
    await writeSkill(root, 'packages/blocked/skills/blocked', 'Blocked')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      package_id: 'usable', skill_id: 'demo', category: 'developer-tools',
      author: { name: 'OpenAI', email: '' }, tags: ['test', 'codex'],
      icon: {
        card: { content_type: 'image/svg+xml' }, detail: { content_type: 'image/png' }, brand_color: '#0B7285',
      },
    })
    expect(result.skills[0]!.icon_assets).toHaveLength(2)
    expect(result.diagnostics).toEqual([{
      package_id: 'blocked',
      code: 'package_invalid',
      message: 'Skipped package: declares unsupported components alongside Skills: apps, mcpServers, hooks',
    }])
  })

  test('identifies image MIME from bytes and isolates packages with mislabeled images', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectSkillImageContentType(png)).toBe('image/png')
    expect(detectSkillImageContentType(new TextEncoder().encode(
      '<?xml version="1.0"?><!-- icon --><svg xmlns="http://www.w3.org/2000/svg"/>',
    ))).toBe('image/svg+xml')

    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-mislabeled-image-'))
    roots.push(root)
    await mkdir(path.join(root, 'packages/demo/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'packages/demo/assets'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'packages/demo' },
    ] }))
    await writeFile(path.join(root, 'packages/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills', interface: { logo: './assets/logo.webp' },
    }))
    await writeFile(path.join(root, 'packages/demo/assets/logo.webp'), png)
    await writeSkill(root, 'packages/demo/skills/demo', 'Demo')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ package_id: 'demo', code: 'package_invalid' })
    expect(result.diagnostics[0]!.message).toContain('content does not match its file extension')
  })

  test('keeps Skill Packages when optional images exceed the image budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-oversized-image-'))
    roots.push(root)
    await mkdir(path.join(root, 'packages/demo/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'packages/demo/assets'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'packages/demo' },
      { name: 'app-only', source: 'packages/app-only' },
    ] }))
    await writeFile(path.join(root, 'packages/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills', interface: { logo: './assets/logo.png' },
    }))
    await writeFile(path.join(root, 'packages/demo/assets/logo.png'), new Uint8Array(MAX_SKILL_IMAGE_BYTES + 1))
    await writeSkill(root, 'packages/demo/skills/demo', 'Demo')
    await mkdir(path.join(root, 'packages/app-only/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'packages/app-only/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'app-only', apps: ['./app'],
    }))

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ package_id: 'demo', skill_id: 'demo' })
    expect(result.skills[0]!.icon).toBeUndefined()
    expect(result.diagnostics).toEqual([])
  })

  test('rejects duplicate Marketplace package identities', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-duplicate-packages-'))
    roots.push(root)
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'duplicate', source: 'packages/one' },
      { name: 'duplicate', source: 'packages/two' },
    ] }))
    await expect(buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })).rejects.toThrow('duplicate package ID')
  })

  test('imports explicitly declared nested Skill roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-overlapping-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'packages/demo/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'packages/demo' },
    ] }))
    await writeFile(path.join(root, 'packages/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: ['./skills', './skills/nested'],
    }))
    await writeSkill(root, 'packages/demo/skills', 'Root')
    await writeSkill(root, 'packages/demo/skills/nested', 'Nested')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills.map((skill) => `${skill.package_id}/${skill.skill_id}`)).toEqual([
      'demo/skills',
      'demo/nested',
    ])
    expect(result.diagnostics).toEqual([])
  })

  test('namespaces a shared Skill root declared by different Marketplace packages', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cross-package-overlap-'))
    roots.push(root)
    await mkdir(path.join(root, 'packages/outer/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'packages/outer/inner/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'outer', source: 'packages/outer' },
      { name: 'inner', source: 'packages/outer/inner' },
    ] }))
    await writeFile(path.join(root, 'packages/outer/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'outer', skills: './inner/skills/demo',
    }))
    await writeFile(path.join(root, 'packages/outer/inner/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'inner', skills: './skills/demo',
    }))
    await writeSkill(root, 'packages/outer/inner/skills/demo', 'Demo')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills.map((skill) => `${skill.package_id}/${skill.skill_id}`)).toEqual([
      'outer/demo',
      'inner/demo',
    ])
    expect(result.diagnostics).toEqual([])
  })

  test('isolates per-package failures as diagnostics instead of aborting the registry build', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-package-isolation-'))
    roots.push(root)
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'usable', source: { source: 'local', path: 'packages/usable' } },
      { name: 'missing-dir', source: { source: 'local', path: 'packages/missing-dir' } },
      { name: 'malformed-json', source: { source: 'local', path: 'packages/malformed-json' } },
      { name: 'name-mismatch', source: { source: 'local', path: 'packages/name-mismatch' } },
      { name: 'dup-skill', source: { source: 'local', path: 'packages/dup-skill' } },
    ] }))

    await mkdir(path.join(root, 'packages/usable/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'packages/usable/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'usable', skills: './skills',
    }))
    await writeSkill(root, 'packages/usable/skills/demo', 'Demo')

    // packages/missing-dir intentionally does not exist on disk.

    await mkdir(path.join(root, 'packages/malformed-json/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'packages/malformed-json/.codex-plugin/plugin.json'), '{ this is not json')

    await mkdir(path.join(root, 'packages/name-mismatch/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'packages/name-mismatch/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'something-else',
    }))

    await mkdir(path.join(root, 'packages/dup-skill/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'packages/dup-skill/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'dup-skill', skills: ['./variant-a/demo', './variant-b/demo'],
    }))
    await writeSkill(root, 'packages/dup-skill/variant-a/demo', 'DemoA')
    await writeSkill(root, 'packages/dup-skill/variant-b/demo', 'DemoB')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ package_id: 'usable', skill_id: 'demo' })

    expect(result.diagnostics).toHaveLength(4)
    expect(result.diagnostics[0]).toMatchObject({ package_id: 'missing-dir', code: 'package_invalid' })
    expect(result.diagnostics[1]).toMatchObject({ package_id: 'malformed-json', code: 'package_invalid' })
    expect(result.diagnostics[2]).toMatchObject({ package_id: 'name-mismatch', code: 'package_invalid' })
    expect(result.diagnostics[2]!.message).toContain('manifest name does not match')
    expect(result.diagnostics[3]).toMatchObject({ package_id: 'dup-skill', code: 'package_invalid' })
    expect(result.diagnostics[3]!.message).toContain('duplicate skill ID demo')
  })

  test('rejects skill roots that escape through symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-symlink-source-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'skill-symlink-outside-'))
    roots.push(root, outside)
    await writeSkill(outside, '.', 'Outside')
    await symlink(outside, path.join(root, 'escaped'))
    await expect(buildSkillCandidates({ definition: definition('skill_directory'), sourceRoot: root }))
      .resolves.toEqual({ skills: [], diagnostics: [], packageMetadata: new Map() })

    await mkdir(path.join(root, 'package'), { recursive: true })
    await symlink(outside, path.join(root, 'package/escaped'))
    await expect(readDirectoryFiles(path.join(root, 'package/escaped'), root)).rejects.toThrow('escapes source')
  })

  test('enforces a byte limit while reading files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-bounded-read-'))
    roots.push(root)
    const target = path.join(root, 'growing.txt')
    await writeFile(target, 'too-large')
    await expect(readFileBounded(target, 3)).rejects.toThrow('exceeds 3 bytes')
  })

  test('preserves file names that collide with object prototype properties', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-prototype-file-'))
    roots.push(root)
    await writeFile(path.join(root, '__proto__'), 'content')
    const files = await readDirectoryFiles(root)
    expect(Object.keys(files)).toEqual(['__proto__'])
    expect(new TextDecoder().decode(files.__proto__?.bytes)).toBe('content')
  })

  test('normalizes scalar author and tag metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-scalar-metadata-'))
    roots.push(root)
    await mkdir(path.join(root, 'demo'), { recursive: true })
    await writeFile(path.join(root, 'demo/SKILL.md'), `---\nname: Demo\ndescription: Demo\nmetadata:\n  author: Demo Team <demo@example.com>\n  tags: docs, reports\n---\n`)
    const result = await buildSkillCandidates({ definition: definition('skill_directory'), sourceRoot: root })
    expect(result.skills[0]).toMatchObject({
      author: { name: 'Demo Team', email: 'demo@example.com' }, tags: ['docs', 'reports'],
    })
  })
})
