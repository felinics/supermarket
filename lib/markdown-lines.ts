export interface MarkdownLines {
  lines: string[]
  length: number
}

export function markdownLines(lines: readonly string[] = []): MarkdownLines {
  return {
    lines: [...lines],
    length: lines.reduce((total, line, index) => total + line.length + (index ? 1 : 0), 0),
  }
}

export function appendMarkdownLines(target: MarkdownLines, source: MarkdownLines) {
  if (!source.lines.length) return target
  if (target.lines.length) target.length++
  target.length += source.length
  for (const line of source.lines) target.lines.push(line)
  return target
}

export function combinedMarkdownLength(...blocks: MarkdownLines[]) {
  let length = 0
  let populated = 0
  for (const block of blocks) {
    if (!block.lines.length) continue
    if (populated) length++
    length += block.length
    populated++
  }
  return length
}

export function renderMarkdownLines(block: MarkdownLines) {
  return block.lines.join('\n')
}
