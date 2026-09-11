import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_SKILL_IMAGE_BYTES, type SkillRegistryAdapter, type SkillRegistryDefinition } from '../types'
import { readDirectoryFiles, readFileBounded } from '../filesystem'
import { parseAppPostinstall } from '../app-manifest'
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

async function writeAppManifest(
  root: string,
  id: string,
  extra = '',
  options: { manifestID?: string; category?: string } = {},
) {
  await mkdir(path.join(root, id), { recursive: true })
  await writeFile(path.join(root, id, 'app.yaml'), `schema_version: "2"
id: ${options.manifestID ?? id}
version: 1.2.0
name: ${id}
description: ${id} app
category: ${options.category ?? 'other'}
${extra}`)
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
      app_id: 'alpha', skill_id: 'alpha', install_id: 'example+alpha+alpha',
      name: 'Alpha', description: 'Alpha description', tags: ['test'],
    })
    expect(Object.keys(result.skills[0]!.files).sort()).toEqual(['SKILL.md', 'reference.md', 'run.sh'])
    expect(result.skills[0]!.files['run.sh']?.mode).toBe(0o755)
  })

  test('imports namespaced skills from app directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'app-skills-'))
    roots.push(root)
    await writeSkill(root, 'notion/skills/search', 'Search')
    await writeSkill(root, 'notion/skills/write', 'Write')
    await writeSkill(root, 'github/skills/review', 'Review')
    await writeAppManifest(root, 'notion', `postinstall:
  - command: npm
    args: [install, --global, opencli]
tags: [notion, docs]
translations:
  zh: { name: Notion 工具, description: 搜索与写入 Notion }
`)
    await writeAppManifest(root, 'github', '', { category: 'developer-tools' })

    const result = await buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.apps.get('notion')).toMatchObject({
      app_id: 'notion', reviewed: true, version: '1.2.0', name: 'notion', category: 'other',
      tags: ['notion', 'docs'], dependencies: [], connectors: [],
      translations: { zh: { name: 'Notion 工具', description: '搜索与写入 Notion' } },
      postinstall: [{ command: 'npm', args: ['install', '--global', 'opencli'] }],
    })
    expect(result.apps.get('github')).toMatchObject({ category: 'developer-tools' })
    expect(result.apps.get('github')!.postinstall).toBeUndefined()
    expect(result.skills.map((skill) => ({
      app_id: skill.app_id,
      skill_id: skill.skill_id,
      install_id: skill.install_id,
      source_path: skill.source_path,
      source_category: skill.source_category,
      tags: skill.tags,
    }))).toEqual([
      {
        app_id: 'github', skill_id: 'review', install_id: 'example+github+review',
        source_path: 'github/skills/review', source_category: 'developer-tools', tags: ['test'],
      },
      {
        app_id: 'notion', skill_id: 'search', install_id: 'example+notion+search',
        source_path: 'notion/skills/search', source_category: 'other', tags: ['test', 'notion', 'docs'],
      },
      {
        app_id: 'notion', skill_id: 'write', install_id: 'example+notion+write',
        source_path: 'notion/skills/write', source_category: 'other', tags: ['test', 'notion', 'docs'],
      },
    ])
  })

  test('imports Apps that only reference dependencies and connectors', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'app-references-'))
    roots.push(root)
    await mkdir(path.join(root, 'codex'), { recursive: true })
    await writeFile(path.join(root, 'codex/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeAppManifest(root, 'codex', `icon: icon.svg
dependencies: [codex]
connectors:
  - github
  - { type: notion, required: false }
`)
    const result = await buildSkillCandidates({ definition: definition('memoh'), sourceRoot: root })
    expect(result.skills).toEqual([])
    expect(result.apps.get('codex')).toMatchObject({
      dependencies: ['codex'],
      connectors: [{ type: 'github', required: true }, { type: 'notion', required: false }],
      icon: { card: { content_type: 'image/svg+xml' }, detail: { content_type: 'image/svg+xml' } },
    })
    expect(result.apps.get('codex')!.icon_assets).toHaveLength(1)
  })

  test('rejects malformed app directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-app-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'empty/skills'), { recursive: true })

    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('app.yaml is required')

    await writeAppManifest(root, 'empty')
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('declares no skills, dependencies or connectors')

    await writeAppManifest(root, 'empty', 'dependencies: [node]\n', { manifestID: 'mismatch' })
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('id must match the app directory')
  })

  test('rejects unsafe or unsupported Memoh App manifests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-app-manifest-'))
    roots.push(root)
    await writeSkill(root, 'tools/skills/tools', 'Tools')

    await writeAppManifest(root, 'tools', `postinstall:
  - command: sh
    args: [-c, echo unsafe]
`)
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('supported executable name')

    await writeAppManifest(root, 'tools', `postinstall:
  - command: npm
    args: [install, opencli]
    shell: true
`)
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('unsupported field shell')

    await writeFile(path.join(root, 'tools/app.yaml'), `schema_version: "1"
postinstall:
  - command: npm
    args: [install, opencli]
`)
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('unsupported schema_version 1')

    await writeAppManifest(root, 'tools', 'homepage: ftp://example.test\n')
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('homepage')

    await writeAppManifest(root, 'tools', 'connectors: [github, github]\n')
    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('duplicate connector types')

    expect(() => parseAppPostinstall([
      { command: 'npm', args: ['\uD800'] },
    ], 'postinstall')).toThrow('unpaired UTF-16 surrogate')
  })

  test('rejects Memoh App manifests that escape through symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'app-manifest-symlink-source-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'app-manifest-symlink-outside-'))
    roots.push(root, outside)
    await writeSkill(root, 'tools/skills/tools', 'Tools')
    await writeFile(path.join(outside, 'app.yaml'), 'schema_version: "2"\n')
    await symlink(path.join(outside, 'app.yaml'), path.join(root, 'tools/app.yaml'))

    await expect(buildSkillCandidates({
      definition: definition('memoh'), sourceRoot: root,
    })).rejects.toThrow('escapes source through a symlink')
  })

  test('imports pure Skill Apps and rejects mixed Codex Apps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps/usable/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'apps/blocked/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'usable', category: 'Developer Tools', source: { source: 'local', path: 'apps/usable' } },
      { name: 'blocked', source: { source: 'local', path: 'apps/blocked' } },
    ] }))
    await writeFile(path.join(root, 'apps/usable/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'usable', author: { name: 'OpenAI' }, keywords: ['codex'], skills: './skills',
      interface: {
        composerIcon: './assets/icon.svg', logo: './assets/logo.png', brandColor: '#0b7285',
      },
    }))
    await mkdir(path.join(root, 'apps/usable/assets'), { recursive: true })
    await writeFile(path.join(root, 'apps/usable/assets/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(path.join(root, 'apps/usable/assets/logo.png'), new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
    await writeFile(path.join(root, 'apps/blocked/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'blocked', skills: './skills', apps: ['./app'],
      mcpServers: { example: { url: 'https://example.test' } }, hooks: { sessionStart: ['./hook'] },
    }))
    await writeSkill(root, 'apps/usable/skills/demo', 'Demo')
    await writeSkill(root, 'apps/blocked/skills/blocked', 'Blocked')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      app_id: 'usable', skill_id: 'demo', category: 'developer-tools',
      author: { name: 'OpenAI', email: '' }, tags: ['test', 'codex'],
      icon: {
        card: { content_type: 'image/svg+xml' }, detail: { content_type: 'image/png' }, brand_color: '#0B7285',
      },
    })
    expect(result.skills[0]!.icon_assets).toHaveLength(2)
    expect(result.diagnostics).toEqual([{
      app_id: 'blocked',
      code: 'app_invalid',
      message: 'Skipped app: declares unsupported components alongside Skills: apps, mcpServers, hooks',
    }])
  })

  test('identifies image MIME from bytes and isolates apps with mislabeled images', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectSkillImageContentType(png)).toBe('image/png')
    expect(detectSkillImageContentType(new TextEncoder().encode(
      '<?xml version="1.0"?><!-- icon --><svg xmlns="http://www.w3.org/2000/svg"/>',
    ))).toBe('image/svg+xml')

    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-mislabeled-image-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps/demo/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'apps/demo/assets'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'apps/demo' },
    ] }))
    await writeFile(path.join(root, 'apps/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills', interface: { logo: './assets/logo.webp' },
    }))
    await writeFile(path.join(root, 'apps/demo/assets/logo.webp'), png)
    await writeSkill(root, 'apps/demo/skills/demo', 'Demo')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ app_id: 'demo', code: 'app_invalid' })
    expect(result.diagnostics[0]!.message).toContain('content does not match its file extension')
  })

  test('keeps Skill Apps when optional images exceed the image budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-oversized-image-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps/demo/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'apps/demo/assets'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'apps/demo' },
      { name: 'app-only', source: 'apps/app-only' },
    ] }))
    await writeFile(path.join(root, 'apps/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills', interface: { logo: './assets/logo.png' },
    }))
    await writeFile(path.join(root, 'apps/demo/assets/logo.png'), new Uint8Array(MAX_SKILL_IMAGE_BYTES + 1))
    await writeSkill(root, 'apps/demo/skills/demo', 'Demo')
    await mkdir(path.join(root, 'apps/app-only/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'apps/app-only/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'app-only', apps: ['./app'],
    }))

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ app_id: 'demo', skill_id: 'demo' })
    expect(result.skills[0]!.icon).toBeUndefined()
    expect(result.diagnostics).toEqual([])
  })

  test('rejects duplicate Marketplace app identities', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-duplicate-apps-'))
    roots.push(root)
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'duplicate', source: 'apps/one' },
      { name: 'duplicate', source: 'apps/two' },
    ] }))
    await expect(buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })).rejects.toThrow('duplicate app ID')
  })

  test('imports explicitly declared nested Skill roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-overlapping-skills-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps/demo/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'demo', source: 'apps/demo' },
    ] }))
    await writeFile(path.join(root, 'apps/demo/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'demo', skills: ['./skills', './skills/nested'],
    }))
    await writeSkill(root, 'apps/demo/skills', 'Root')
    await writeSkill(root, 'apps/demo/skills/nested', 'Nested')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills.map((skill) => `${skill.app_id}/${skill.skill_id}`)).toEqual([
      'demo/skills',
      'demo/nested',
    ])
    expect(result.diagnostics).toEqual([])
  })

  test('namespaces a shared Skill root declared by different Marketplace apps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cross-app-overlap-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps/outer/.codex-plugin'), { recursive: true })
    await mkdir(path.join(root, 'apps/outer/inner/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'outer', source: 'apps/outer' },
      { name: 'inner', source: 'apps/outer/inner' },
    ] }))
    await writeFile(path.join(root, 'apps/outer/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'outer', skills: './inner/skills/demo',
    }))
    await writeFile(path.join(root, 'apps/outer/inner/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'inner', skills: './skills/demo',
    }))
    await writeSkill(root, 'apps/outer/inner/skills/demo', 'Demo')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })
    expect(result.skills.map((skill) => `${skill.app_id}/${skill.skill_id}`)).toEqual([
      'outer/demo',
      'inner/demo',
    ])
    expect(result.diagnostics).toEqual([])
  })

  test('isolates per-app failures as diagnostics instead of aborting the registry build', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-app-isolation-'))
    roots.push(root)
    await writeFile(path.join(root, 'marketplace.json'), JSON.stringify({ plugins: [
      { name: 'usable', source: { source: 'local', path: 'apps/usable' } },
      { name: 'missing-dir', source: { source: 'local', path: 'apps/missing-dir' } },
      { name: 'malformed-json', source: { source: 'local', path: 'apps/malformed-json' } },
      { name: 'name-mismatch', source: { source: 'local', path: 'apps/name-mismatch' } },
      { name: 'dup-skill', source: { source: 'local', path: 'apps/dup-skill' } },
    ] }))

    await mkdir(path.join(root, 'apps/usable/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'apps/usable/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'usable', skills: './skills',
    }))
    await writeSkill(root, 'apps/usable/skills/demo', 'Demo')

    // apps/missing-dir intentionally does not exist on disk.

    await mkdir(path.join(root, 'apps/malformed-json/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'apps/malformed-json/.codex-plugin/plugin.json'), '{ this is not json')

    await mkdir(path.join(root, 'apps/name-mismatch/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'apps/name-mismatch/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'something-else',
    }))

    await mkdir(path.join(root, 'apps/dup-skill/.codex-plugin'), { recursive: true })
    await writeFile(path.join(root, 'apps/dup-skill/.codex-plugin/plugin.json'), JSON.stringify({
      name: 'dup-skill', skills: ['./variant-a/demo', './variant-b/demo'],
    }))
    await writeSkill(root, 'apps/dup-skill/variant-a/demo', 'DemoA')
    await writeSkill(root, 'apps/dup-skill/variant-b/demo', 'DemoB')

    const result = await buildSkillCandidates({
      definition: definition('codex_marketplace_skills'), sourceRoot: root,
    })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ app_id: 'usable', skill_id: 'demo' })

    expect(result.diagnostics).toHaveLength(4)
    expect(result.diagnostics[0]).toMatchObject({ app_id: 'missing-dir', code: 'app_invalid' })
    expect(result.diagnostics[1]).toMatchObject({ app_id: 'malformed-json', code: 'app_invalid' })
    expect(result.diagnostics[2]).toMatchObject({ app_id: 'name-mismatch', code: 'app_invalid' })
    expect(result.diagnostics[2]!.message).toContain('manifest name does not match')
    expect(result.diagnostics[3]).toMatchObject({ app_id: 'dup-skill', code: 'app_invalid' })
    expect(result.diagnostics[3]!.message).toContain('duplicate skill ID demo')
  })

  test('rejects skill roots that escape through symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-symlink-source-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'skill-symlink-outside-'))
    roots.push(root, outside)
    await writeSkill(outside, '.', 'Outside')
    await symlink(outside, path.join(root, 'escaped'))
    await expect(buildSkillCandidates({ definition: definition('skill_directory'), sourceRoot: root }))
      .resolves.toEqual({ skills: [], diagnostics: [], apps: new Map() })

    await mkdir(path.join(root, 'app'), { recursive: true })
    await symlink(outside, path.join(root, 'app/escaped'))
    await expect(readDirectoryFiles(path.join(root, 'app/escaped'), root)).rejects.toThrow('escapes source')
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
