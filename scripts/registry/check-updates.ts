import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadSkillRegistryDefinitions } from '#registry/definitions/repository'
import {
  buildSkillRegistryCandidate,
  type SkillRegistryCandidate,
} from '#registry/publish/candidate'
import {
  assertReleaseCandidate,
  loadRegistryReleaseLock,
  writeRegistryReleaseLock,
} from '#registry/publish/release-lock'
import {
  diffRegistryCandidates,
  renderRegistryReleaseDiff,
  type RegistryReviewCandidate,
} from '#registry/review/release-diff'
import type { SkillRegistryDefinition } from '#registry/types'

export interface RegistryUpdate {
  registry: string
  source_url: string
  tracking_ref: string
  approved_revision: string
  candidate_revision: string
  compare_url?: string
}

export const MAX_REGISTRY_UPDATE_REPORT_LENGTH = 60_000

export function renderRegistryUpdateReport(
  diff: Parameters<typeof renderRegistryReleaseDiff>[0],
  compareURL: string | undefined,
  fullReportURL?: string,
) {
  const report = renderRegistryReleaseDiff(
    diff,
    compareURL,
    MAX_REGISTRY_UPDATE_REPORT_LENGTH,
    fullReportURL,
  )
  if (report.length > MAX_REGISTRY_UPDATE_REPORT_LENGTH) {
    throw new Error('Registry update report exceeds the GitHub PR body limit')
  }
  return report
}

export function renderFullRegistryUpdateReport(
  diff: Parameters<typeof renderRegistryReleaseDiff>[0],
  compareURL: string | undefined,
) {
  return renderRegistryReleaseDiff(diff, compareURL, Number.POSITIVE_INFINITY)
}

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function remoteRef(value: string) {
  if (value.startsWith('refs/')) return value
  return `refs/heads/${value}`
}

async function resolveGitRevision(definition: SkillRegistryDefinition) {
  if (definition.source.type !== 'git' || !definition.source.tracking_ref) return undefined
  const ref = remoteRef(definition.source.tracking_ref)
  const child = Bun.spawn(['git', 'ls-remote', '--exit-code', definition.source.url, ref], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`${definition.id}: cannot resolve ${definition.source.tracking_ref}: ${stderr.trim()}`)
  }
  const revision = stdout.trim().split(/\s+/)[0]
  if (!revision || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error(`${definition.id}: upstream returned an invalid Git revision`)
  }
  return revision
}

function compareURL(url: string, approved: string, candidate: string) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? `https://github.com/${match[1]}/compare/${approved}...${candidate}` : undefined
}

function reviewCandidate(candidate: SkillRegistryCandidate): RegistryReviewCandidate {
  return {
    definition: candidate.definition,
    source_revision: candidate.source_revision,
    revision: candidate.revision,
    snapshot: candidate.snapshot,
    skills: candidate.skills,
    diagnostics: candidate.diagnostics,
    review: candidate.review,
  }
}

async function applyRevision(
  projectRoot: string,
  definition: SkillRegistryDefinition,
  candidateRevision: string,
) {
  if (definition.source.type !== 'git') throw new Error(`${definition.id}: expected a Git source`)
  const file = path.join(projectRoot, 'registries', definition.id, 'registry.yaml')
  const current = await readFile(file, 'utf8')
  const line = new RegExp(`^(\\s*revision:\\s*)${definition.source.revision}(\\s*(?:#.*)?)$`, 'm')
  if (!line.test(current)) {
    throw new Error(`${definition.id}: registry.yaml does not contain the approved revision`)
  }
  await writeFile(file, current.replace(line, `$1${candidateRevision}$2`))
}

export async function checkRegistryUpdates(
  projectRoot: string,
  selectedID?: string,
) {
  const definitions = await loadSkillRegistryDefinitions(projectRoot)
  const selected = selectedID
    ? definitions.filter((definition) => definition.id === selectedID)
    : definitions
  if (selectedID && !selected.length) throw new Error(`Registry not found: ${selectedID}`)

  const updates: RegistryUpdate[] = []
  for (const definition of selected) {
    if (definition.source.type !== 'git' || !definition.source.tracking_ref) continue
    const candidate = await resolveGitRevision(definition)
    if (!candidate || candidate === definition.source.revision) continue
    updates.push({
      registry: definition.id,
      source_url: definition.source.url,
      tracking_ref: definition.source.tracking_ref,
      approved_revision: definition.source.revision,
      candidate_revision: candidate,
      compare_url: compareURL(definition.source.url, definition.source.revision, candidate),
    })
  }
  return updates
}

async function prepareRegistryUpdate(input: {
  projectRoot: string
  registry: string
  candidateRevision: string
  reportPath: string
  fullReportPath?: string
  fullReportURL?: string
}) {
  if (!/^[a-f0-9]{40}$/.test(input.candidateRevision)) {
    throw new Error('Candidate revision must be a full Git commit hash')
  }
  const definitions = await loadSkillRegistryDefinitions(input.projectRoot)
  const definition = definitions.find((item) => item.id === input.registry)
  if (!definition) throw new Error(`Registry not found: ${input.registry}`)
  if (definition.source.type !== 'git' || !definition.source.tracking_ref) {
    throw new Error(`${input.registry}: Registry does not track a Git ref`)
  }
  if (definition.source.revision === input.candidateRevision) {
    throw new Error(`${input.registry}: candidate revision is already approved`)
  }

  const candidateDefinition: SkillRegistryDefinition = {
    ...definition,
    source: { ...definition.source, revision: input.candidateRevision },
  }
  if (!definition.enabled) throw new Error(`${input.registry}: Registry is disabled`)
  const builtApproved = await buildSkillRegistryCandidate(definition, input.projectRoot, {
    includeReview: true,
  })
  const approved = reviewCandidate(builtApproved)
  builtApproved.artifacts.clear()
  builtApproved.images.clear()
  const lock = await loadRegistryReleaseLock(input.projectRoot, definition)
  const builtCandidate = await buildSkillRegistryCandidate(candidateDefinition, input.projectRoot, {
    includeReview: true,
  })
  const candidate = {
    definition: builtCandidate.definition,
    revision: builtCandidate.revision,
    snapshot: builtCandidate.snapshot,
  }
  const candidateReview = reviewCandidate(builtCandidate)
  builtCandidate.artifacts.clear()
  builtCandidate.images.clear()
  assertReleaseCandidate(definition, lock, approved.revision)
  const diff = diffRegistryCandidates(approved, candidateReview)
  const url = compareURL(
    definition.source.url,
    definition.source.revision,
    input.candidateRevision,
  )
  await writeFile(
    input.reportPath,
    renderRegistryUpdateReport(
      diff,
      url,
      input.fullReportURL,
    ),
  )
  if (input.fullReportPath) {
    await writeFile(
      input.fullReportPath,
      renderFullRegistryUpdateReport(diff, url),
    )
  }
  await applyRevision(input.projectRoot, definition, input.candidateRevision)
  await writeRegistryReleaseLock(input.projectRoot, candidateDefinition, {
    snapshot_revision: candidate.revision,
  })
  return diff
}

if (import.meta.main) {
  const projectRoot = path.resolve(import.meta.dirname, '../..')
  const registry = option('--registry')
  const candidateRevision = option('--candidate')
  const reportPath = option('--report')
  const fullReportPath = option('--full-report')
  const fullReportURL = option('--full-report-url')
  if (registry || candidateRevision || reportPath || fullReportPath || fullReportURL) {
    if (!registry || !candidateRevision || !reportPath) {
      throw new Error('--registry, --candidate, and --report must be provided together')
    }
    if (Boolean(fullReportPath) !== Boolean(fullReportURL)) {
      throw new Error('--full-report and --full-report-url must be provided together')
    }
    const diff = await prepareRegistryUpdate({
      projectRoot,
      registry,
      candidateRevision,
      reportPath: path.resolve(reportPath),
      fullReportPath: fullReportPath ? path.resolve(fullReportPath) : undefined,
      fullReportURL,
    })
    console.log(JSON.stringify(diff.summary, null, 2))
  } else {
    const updates = await checkRegistryUpdates(projectRoot, option('--check-registry'))
    const matrix = {
      include: updates.map((update) => ({
        registry: update.registry,
        candidate_revision: update.candidate_revision,
      })),
    }
    const githubOutput = process.env.GITHUB_OUTPUT
    if (githubOutput) {
      await writeFile(
        githubOutput,
        `changed=${updates.length ? 'true' : 'false'}\nmatrix=${JSON.stringify(matrix)}\n`,
        { flag: 'a' },
      )
    }
    console.log(JSON.stringify({ changed: updates.length > 0, matrix, updates }, null, 2))
  }
}
