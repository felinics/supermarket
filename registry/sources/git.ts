import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SkillRegistryDefinition } from '../types'
import { resolveRealInside } from '../filesystem'
import type { MaterializedSkillRegistrySource } from './types'

const gitCommandTimeoutMs = 2 * 60 * 1000
const gitFetchTimeoutMs = 15 * 60 * 1000

async function exec(
  command: string,
  args: string[],
  timeoutMs = gitCommandTimeoutMs,
  stdin?: Uint8Array,
) {
  const child = Bun.spawn([command, ...args], {
    stdin: stdin ?? 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill(9)
  }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) throw new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`)
    if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed (${exitCode}): ${stderr.trim()}`)
    return stdout.trim()
  } finally {
    clearTimeout(timer)
  }
}

function assertSparsePath(sourcePath: string) {
  if (!sourcePath || sourcePath.includes('\0') || /[\\\r\n*?!#]/u.test(sourcePath)
    || /[ \t]$/u.test(sourcePath) || sourcePath.includes('[') || sourcePath.includes(']')) {
    throw new Error(`Git source path cannot be represented safely in a sparse checkout: ${sourcePath}`)
  }
  return sourcePath
}

export function gitSparsePattern(sourcePath: string) {
  return `/${assertSparsePath(sourcePath)}`
}

async function setSparsePaths(repository: string, paths: Iterable<string>) {
  const patterns = [...paths].map(gitSparsePattern)
  if (!patterns.length) return
  await exec(
    'git',
    ['-C', repository, 'sparse-checkout', 'set', '--no-cone', '--stdin'],
    gitCommandTimeoutMs,
    new TextEncoder().encode(`${patterns.join('\n')}\n`),
  )
}

async function checkoutGit(url: string, revision: string, sparsePaths: string[] = []) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'supermarket-skills-git-'))
  const repository = path.join(temporaryRoot, 'repository')
  try {
    await exec('git', ['init', repository])
    await exec('git', ['-C', repository, 'config', 'core.autocrlf', 'false'])
    await exec('git', ['-C', repository, 'remote', 'add', 'origin', url])
    await exec(
      'git',
      ['-C', repository, 'fetch', '--quiet', '--no-progress', '--no-tags', '--depth', '1', '--filter=blob:none', 'origin', revision],
      gitFetchTimeoutMs,
    )
    if (sparsePaths.length) {
      await exec('git', ['-C', repository, 'sparse-checkout', 'init', '--no-cone'])
      await setSparsePaths(repository, sparsePaths)
    }
    await exec('git', ['-C', repository, 'checkout', '--detach', 'FETCH_HEAD'])
    const resolvedRevision = await exec('git', ['-C', repository, 'rev-parse', 'HEAD'])
    if (resolvedRevision !== revision) {
      throw new Error(`Git source resolved an unexpected revision: expected ${revision}, got ${resolvedRevision}`)
    }
    return { temporaryRoot, repository, revision: resolvedRevision }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

export async function materializeGitSource(
  definition: SkillRegistryDefinition,
  bootstrapPaths: string[] = [],
): Promise<MaterializedSkillRegistrySource> {
  if (definition.source.type !== 'git') throw new Error('Expected a Git Registry source')
  const sourceBase = definition.source.path ?? ''
  const initialPaths = bootstrapPaths.length
    ? bootstrapPaths.map((item) => [sourceBase, item].filter(Boolean).join('/'))
    : sourceBase ? [sourceBase] : []
  const checkout = await checkoutGit(definition.source.url, definition.source.revision, initialPaths)
  try {
    const selectedPaths = new Set(initialPaths)
    return {
      root: await resolveRealInside(checkout.repository, sourceBase),
      revision: checkout.revision,
      definition,
      ensurePaths: async (paths) => {
        for (const item of paths) selectedPaths.add([sourceBase, item].filter(Boolean).join('/'))
        await setSparsePaths(checkout.repository, selectedPaths)
      },
      cleanup: () => rm(checkout.temporaryRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(checkout.temporaryRoot, { recursive: true, force: true })
    throw error
  }
}
