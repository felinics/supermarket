import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'

test('managed recipes preserve published installations and validate downloads', () => {
  const result = spawnSync('python3', [import.meta.dirname + '/runtime_test.py'], { encoding: 'utf8' })
  expect(result.stderr).not.toContain('FAILED')
  expect(result.status).toBe(0)
})

test('committed managed recipes match their shared source', () => {
  const result = spawnSync(process.execPath, [import.meta.dirname + '/generate.ts', '--check'], { encoding: 'utf8' })
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})
