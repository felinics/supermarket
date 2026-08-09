import type { PackagePostinstallCommand, SkillPackageMetadata } from './types'

export const MAX_PACKAGE_MANIFEST_BYTES = 64 * 1024
export const MAX_PACKAGE_POSTINSTALL_COMMANDS = 8
export const MAX_PACKAGE_POSTINSTALL_ARGS = 64
export const MAX_PACKAGE_POSTINSTALL_COMMAND_BYTES = 128
export const MAX_PACKAGE_POSTINSTALL_ARG_BYTES = 4 * 1024
export const MAX_PACKAGE_POSTINSTALL_BYTES = 64 * 1024

const executablePattern = /^[a-z0-9][a-z0-9._+-]*$/i
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u
const unsupportedExecutables = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'dash',
  'env',
  'fish',
  'powershell',
  'powershell.exe',
  'pwsh',
  'sh',
  'sudo',
  'zsh',
])
const encoder = new TextEncoder()

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    }
    else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key))
  if (unsupported.length) throw new Error(`${label} contains unsupported field ${unsupported.join(', ')}`)
}

function boundedString(value: unknown, maximum: number, label: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || encoder.encode(value).length > maximum) {
    throw new Error(`${label} must be a string of at most ${maximum} bytes`)
  }
  if (!isWellFormedUnicode(value)) throw new Error(`${label} contains an unpaired UTF-16 surrogate`)
  if (controlCharacterPattern.test(value)) throw new Error(`${label} contains a control character`)
  return value
}

export function parsePackagePostinstall(value: unknown, label: string): PackagePostinstallCommand[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PACKAGE_POSTINSTALL_COMMANDS) {
    throw new Error(`${label} must contain between 1 and ${MAX_PACKAGE_POSTINSTALL_COMMANDS} commands`)
  }
  const commands = value.map((raw, index) => {
    const commandLabel = `${label}[${index}]`
    const item = object(raw, commandLabel)
    rejectUnknownFields(item, new Set(['command', 'args']), commandLabel)
    const command = boundedString(
      item.command,
      MAX_PACKAGE_POSTINSTALL_COMMAND_BYTES,
      `${commandLabel}.command`,
    )
    if (!executablePattern.test(command) || unsupportedExecutables.has(command.toLowerCase())) {
      throw new Error(`${commandLabel}.command must be a supported executable name`)
    }
    if (!Array.isArray(item.args) || item.args.length > MAX_PACKAGE_POSTINSTALL_ARGS) {
      throw new Error(`${commandLabel}.args must contain at most ${MAX_PACKAGE_POSTINSTALL_ARGS} arguments`)
    }
    const args = item.args.map((arg, argIndex) => boundedString(
      arg,
      MAX_PACKAGE_POSTINSTALL_ARG_BYTES,
      `${commandLabel}.args[${argIndex}]`,
      true,
    ))
    return { command, args }
  })
  if (encoder.encode(JSON.stringify(commands)).length > MAX_PACKAGE_POSTINSTALL_BYTES) {
    throw new Error(`${label} exceeds ${MAX_PACKAGE_POSTINSTALL_BYTES} bytes`)
  }
  return commands
}

export function parseSkillPackageManifest(raw: unknown, label: string): SkillPackageMetadata {
  const manifest = object(raw, label)
  rejectUnknownFields(manifest, new Set(['schema_version', 'postinstall']), label)
  if (manifest.schema_version !== '1') {
    throw new Error(`${label} uses unsupported schema_version ${String(manifest.schema_version)}`)
  }
  return manifest.postinstall === undefined
    ? {}
    : { postinstall: parsePackagePostinstall(manifest.postinstall, `${label}.postinstall`) }
}
