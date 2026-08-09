import { HTTPError } from 'nitro'
import * as z from 'zod/mini'

function badRequest(message: string): never {
  throw new HTTPError(message, { statusCode: 400 })
}

const scalarSchema = z.union([
  z.pipe(z.string(), z.transform((value) => value.trim())),
  z.pipe(z.null(), z.transform(() => undefined)),
  z.undefined(),
])

export function scalarQuery(query: Record<string, unknown>, name: string) {
  const result = scalarSchema.safeParse(query[name])
  if (!result.success) badRequest(`Query parameter "${name}" must be specified once`)
  return result.data
}

export function positiveIntegerQuery(value: string | undefined, name: string, maximum?: number) {
  if (value == null) return undefined
  const schema = z.pipe(
    z.string().check(z.regex(/^\d+$/, `Query parameter "${name}" must be a positive integer`)),
    z.transform(Number),
  ).check(
    z.refine(
      (number) => Number.isSafeInteger(number) && number >= 1 && (maximum == null || number <= maximum),
      `Query parameter "${name}" is out of range`,
    ),
  )
  const result = schema.safeParse(value)
  if (!result.success) badRequest(result.error.issues[0]!.message)
  return result.data
}
