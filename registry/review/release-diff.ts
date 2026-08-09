import { createTwoFilesPatch } from 'diff'
import {
  appendMarkdownLines,
  combinedMarkdownLength,
  markdownLines,
  renderMarkdownLines,
} from '#lib/markdown-lines'
import type { CatalogSkill, PackagePostinstallCommand } from '../types'
import type {
  CandidateFile,
  CandidateSkillReview,
  SkillRegistryCandidate,
} from '../publish/candidate'

export type RegistryReviewCandidate = Pick<
  SkillRegistryCandidate,
  'definition' | 'source_revision' | 'revision' | 'snapshot' | 'skills' | 'diagnostics' | 'review'
>

type ChangeStatus = 'added' | 'removed' | 'changed'

export interface FileChange {
  path: string
  status: ChangeStatus
  before?: FileRevision
  after?: FileRevision
}

export interface FileRevision {
  digest: string
  size: number
  mode: number
}

export interface TextFilePatch {
  path: string
  patch: string
}

export interface SkillReleaseDiff {
  skill_id: string
  status: ChangeStatus
  artifact_before?: string
  artifact_after?: string
  metadata: string[]
  files: FileChange[]
  text_patches: TextFilePatch[]
}

export interface PackageReleaseDiff {
  package_id: string
  status: ChangeStatus
  postinstall?: {
    before?: PackagePostinstallCommand[]
    after?: PackagePostinstallCommand[]
  }
  skills: SkillReleaseDiff[]
}

export interface RegistryReleaseDiff {
  registry: string
  source_before: string
  source_after: string
  snapshot_before: string
  snapshot_after: string
  skipped_packages: Array<{ package_id: string; message: string }>
  packages: PackageReleaseDiff[]
  summary: {
    packages_skipped: number
    packages_changed: number
    skills_added: number
    skills_removed: number
    skills_changed: number
  }
}

const metadataFields = [
  'name',
  'description',
  'author',
  'homepage',
  'tags',
  'category',
  'category_name',
  'source_category',
  'icon',
  'source',
] as const

function comparableMetadata(skill: CatalogSkill, field: typeof metadataFields[number]) {
  if (field !== 'source') return skill[field]
  const { revision: _revision, ...source } = skill.source
  return source
}

function changedMetadata(previous: CatalogSkill, candidate: CatalogSkill) {
  return metadataFields.filter((field) =>
    JSON.stringify(comparableMetadata(previous, field))
      !== JSON.stringify(comparableMetadata(candidate, field)))
}

function fileChanges(
  previous?: CandidateSkillReview,
  candidate?: CandidateSkillReview,
) {
  const paths = new Set([
    ...Object.keys(previous?.files ?? {}),
    ...Object.keys(candidate?.files ?? {}),
  ])
  return [...paths].sort().flatMap((path): FileChange[] => {
    const before = previous?.files[path]
    const after = candidate?.files[path]
    if (!before) return [{ path, status: 'added', after: fileRevision(after) }]
    if (!after) return [{ path, status: 'removed', before: fileRevision(before) }]
    if (before.digest !== after.digest || before.mode !== after.mode) {
      return [{ path, status: 'changed', before: fileRevision(before), after: fileRevision(after) }]
    }
    return []
  })
}

function fileRevision(file: CandidateFile | undefined): FileRevision | undefined {
  return file && { digest: file.digest, size: file.size, mode: file.mode }
}

function textFilePatch(path: string, previous?: CandidateFile, candidate?: CandidateFile) {
  if (previous?.text === undefined && candidate?.text === undefined) return undefined
  if (previous?.digest && previous.digest === candidate?.digest) return undefined
  const patch = createTwoFilesPatch(
    `${path} (approved)`,
    `${path} (candidate)`,
    previous?.text ?? '',
    candidate?.text ?? '',
    '',
    '',
    { context: 3 },
  )
  const maximum = 8_000
  return patch.length > maximum ? `${patch.slice(0, maximum)}\n... diff truncated ...\n` : patch
}

function textFilePatches(previous?: CandidateSkillReview, candidate?: CandidateSkillReview) {
  const paths = new Set([
    ...Object.keys(previous?.files ?? {}),
    ...Object.keys(candidate?.files ?? {}),
  ])
  return [...paths].sort().flatMap((path): TextFilePatch[] => {
    const patch = textFilePatch(path, previous?.files[path], candidate?.files[path])
    return patch ? [{ path, patch }] : []
  })
}

function indexSkills(candidate: RegistryReviewCandidate) {
  return new Map(candidate.skills.map((skill) => [
    `${skill.package_id}/${skill.skill_id}`,
    skill,
  ]))
}

export function diffRegistryCandidates(
  previous: RegistryReviewCandidate,
  candidate: RegistryReviewCandidate,
): RegistryReleaseDiff {
  if (previous.definition.id !== candidate.definition.id) {
    throw new Error('Cannot compare candidates from different Registries')
  }
  const before = indexSkills(previous)
  const after = indexSkills(candidate)
  const packageIDs = new Set([
    ...previous.skills.map((skill) => skill.package_id),
    ...candidate.skills.map((skill) => skill.package_id),
  ])
  const packages: PackageReleaseDiff[] = []
  for (const packageID of [...packageIDs].sort()) {
    const previousPackage = previous.snapshot.packages.find((pkg) => pkg.package_id === packageID)
    const candidatePackage = candidate.snapshot.packages.find((pkg) => pkg.package_id === packageID)
    const postinstallChanged = JSON.stringify(previousPackage?.postinstall)
      !== JSON.stringify(candidatePackage?.postinstall)
    const skillIDs = new Set([
      ...previous.skills.filter((skill) => skill.package_id === packageID).map((skill) => skill.skill_id),
      ...candidate.skills.filter((skill) => skill.package_id === packageID).map((skill) => skill.skill_id),
    ])
    const skills: SkillReleaseDiff[] = []
    for (const skillID of [...skillIDs].sort()) {
      const key = `${packageID}/${skillID}`
      const oldSkill = before.get(key)
      const newSkill = after.get(key)
      if (!oldSkill && newSkill) {
        skills.push({
          skill_id: skillID,
          status: 'added',
          artifact_after: newSkill.artifact.digest,
          metadata: [],
          files: fileChanges(undefined, candidate.review.get(key)),
          text_patches: textFilePatches(undefined, candidate.review.get(key)),
        })
        continue
      }
      if (oldSkill && !newSkill) {
        skills.push({
          skill_id: skillID,
          status: 'removed',
          artifact_before: oldSkill.artifact.digest,
          metadata: [],
          files: fileChanges(previous.review.get(key), undefined),
          text_patches: textFilePatches(previous.review.get(key), undefined),
        })
        continue
      }
      if (!oldSkill || !newSkill) continue
      const metadata = changedMetadata(oldSkill, newSkill)
      const files = fileChanges(previous.review.get(key), candidate.review.get(key))
      if (oldSkill.artifact.digest === newSkill.artifact.digest && !metadata.length && !files.length) continue
      skills.push({
        skill_id: skillID,
        status: 'changed',
        artifact_before: oldSkill.artifact.digest,
        artifact_after: newSkill.artifact.digest,
        metadata,
        files,
        text_patches: textFilePatches(previous.review.get(key), candidate.review.get(key)),
      })
    }
    if (!skills.length && !postinstallChanged) continue
    const existed = previous.skills.some((skill) => skill.package_id === packageID)
    const exists = candidate.skills.some((skill) => skill.package_id === packageID)
    packages.push({
      package_id: packageID,
      status: !existed ? 'added' : !exists ? 'removed' : 'changed',
      ...(postinstallChanged ? {
        postinstall: {
          ...(previousPackage?.postinstall ? { before: previousPackage.postinstall } : {}),
          ...(candidatePackage?.postinstall ? { after: candidatePackage.postinstall } : {}),
        },
      } : {}),
      skills,
    })
  }

  const changedSkills = packages.flatMap((item) => item.skills)
  const skippedPackages = candidate.diagnostics.flatMap((diagnostic) =>
    diagnostic.code === 'package_invalid' && diagnostic.package_id
      ? [{ package_id: diagnostic.package_id, message: diagnostic.message }]
      : [])
  return {
    registry: previous.definition.id,
    source_before: previous.source_revision,
    source_after: candidate.source_revision,
    snapshot_before: previous.revision,
    snapshot_after: candidate.revision,
    skipped_packages: skippedPackages,
    packages,
    summary: {
      packages_skipped: skippedPackages.length,
      packages_changed: packages.length,
      skills_added: changedSkills.filter((skill) => skill.status === 'added').length,
      skills_removed: changedSkills.filter((skill) => skill.status === 'removed').length,
      skills_changed: changedSkills.filter((skill) => skill.status === 'changed').length,
    },
  }
}

function longestBacktickRun(value: string) {
  return Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
}

function inlineCode(value: string) {
  const delimiter = '`'.repeat(Math.max(1, longestBacktickRun(value) + 1))
  return `${delimiter} ${value} ${delimiter}`
}

function fencedCode(value: string, language: string) {
  const delimiter = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1))
  return [delimiter + language, value.trimEnd(), delimiter]
}

function shortDigest(value?: string) {
  return value ? inlineCode(value.slice(0, 12)) : '—'
}

function fileRevisionLabel(file?: FileRevision) {
  if (!file) return '—'
  return `${inlineCode(file.digest)} (${file.size} B, ${file.mode.toString(8).padStart(4, '0')})`
}

function diagnosticMessage(value: string, maximum: number) {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 3)}...`
}

function renderSkill(skill: SkillReleaseDiff) {
  const lines = [`#### ${inlineCode(skill.skill_id)} — ${skill.status}`, '']
  if (skill.artifact_before || skill.artifact_after) {
    lines.push(`- Artifact: ${shortDigest(skill.artifact_before)} → ${shortDigest(skill.artifact_after)}`)
  }
  if (skill.metadata.length) {
    lines.push(`- Metadata: ${skill.metadata.map(inlineCode).join(', ')}`)
  }
  if (skill.files.length) {
    lines.push('- Files:')
    for (const file of skill.files) {
      const revisions = file.before || file.after
        ? ` — ${fileRevisionLabel(file.before)} → ${fileRevisionLabel(file.after)}`
        : ''
      lines.push(`  - ${file.status}: ${inlineCode(file.path)}${revisions}`)
    }
  }
  for (const { patch } of skill.text_patches) {
    lines.push('', ...fencedCode(patch, 'diff'))
  }
  lines.push('')
  return lines
}

function renderPostinstall(change: NonNullable<PackageReleaseDiff['postinstall']>) {
  return [
    '#### Package postinstall',
    '',
    'Before:',
    ...fencedCode(JSON.stringify(change.before ?? [], null, 2), 'json'),
    '',
    'After:',
    ...fencedCode(JSON.stringify(change.after ?? [], null, 2), 'json'),
    '',
  ]
}

export function renderRegistryReleaseDiff(
  diff: RegistryReleaseDiff,
  compareURL?: string,
  maximum = 60_000,
  fullReportURL?: string,
) {
  const truncationNotice = fullReportURL
    ? `_Report truncated at a complete review item boundary; [download the full workflow report](${fullReportURL}) while it is retained, then use the pinned source revision for the remaining changes._`
    : compareURL
      ? '_Report truncated at a complete review item boundary; use the upstream comparison link for the remaining source changes._'
      : '_Report truncated at a complete review item boundary; inspect the pinned source revision for the remaining changes._'
  const approvalNotice = 'Merging this PR approves the pinned source and release.lock.json. R2 publication rebuilds the Snapshot and requires its revision to match that lock.'
  const output = markdownLines([
    `## ${diff.registry} Registry update`,
    '',
    `Source: \`${diff.source_before.slice(0, 12)}\` → ${compareURL
      ? `[\`${diff.source_after.slice(0, 12)}\`](${compareURL})`
      : `\`${diff.source_after.slice(0, 12)}\``}`,
    '',
    `Snapshot: \`${diff.snapshot_before}\` → \`${diff.snapshot_after}\``,
    '',
    '### Summary',
    '',
    `- Packages skipped: ${diff.summary.packages_skipped}`,
    `- Packages changed: ${diff.summary.packages_changed}`,
    `- Skills added: ${diff.summary.skills_added}`,
    `- Skills removed: ${diff.summary.skills_removed}`,
    `- Skills changed: ${diff.summary.skills_changed}`,
    '',
  ])
  let truncated = false
  const reservedFooter = approvalNotice.length >= truncationNotice.length
    ? approvalNotice
    : truncationNotice
  if (diff.skipped_packages.length) {
    const heading = markdownLines(['### Skipped Packages', ''])
    if (combinedMarkdownLength(output, heading, markdownLines(['', reservedFooter, ''])) > maximum) {
      truncated = true
    } else {
      appendMarkdownLines(output, heading)
      for (const diagnostic of diff.skipped_packages) {
        const message = diagnosticMessage(
          diagnostic.message,
          Number.isFinite(maximum) ? 2_000 : Number.POSITIVE_INFINITY,
        )
        const line = markdownLines([
          `- ${inlineCode(diagnostic.package_id)}: ${inlineCode(message)}`,
        ])
        if (combinedMarkdownLength(output, line, markdownLines(['', reservedFooter, ''])) > maximum) {
          truncated = true
          break
        }
        appendMarkdownLines(output, line)
      }
      appendMarkdownLines(output, markdownLines(['']))
    }
  }
  for (const packageDiff of truncated ? [] : diff.packages) {
    const packageBlock = markdownLines([
      '<details>',
      `<summary><code>${packageDiff.package_id}</code> — ${packageDiff.status}, ${packageDiff.skills.length} Skill(s)</summary>`,
      '',
    ])
    let included = 0
    if (packageDiff.postinstall) {
      const postinstallBlock = markdownLines(renderPostinstall(packageDiff.postinstall))
      const ending = markdownLines(['</details>', '', reservedFooter, ''])
      if (combinedMarkdownLength(output, packageBlock, postinstallBlock, ending) > maximum) {
        truncated = true
        break
      }
      appendMarkdownLines(packageBlock, postinstallBlock)
      included++
    }
    for (const skill of packageDiff.skills) {
      const skillBlock = markdownLines(renderSkill(skill))
      const ending = markdownLines(['</details>', '', reservedFooter, ''])
      if (combinedMarkdownLength(output, packageBlock, skillBlock, ending) > maximum) {
        truncated = true
        break
      }
      appendMarkdownLines(packageBlock, skillBlock)
      included++
    }
    if (!included) {
      truncated = true
      break
    }
    appendMarkdownLines(packageBlock, markdownLines(['</details>', '']))
    appendMarkdownLines(output, packageBlock)
    if (truncated) break
  }
  appendMarkdownLines(output, markdownLines([truncated ? truncationNotice : approvalNotice, '']))
  return renderMarkdownLines(output)
}
