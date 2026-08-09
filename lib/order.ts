/**
 * Stable lexical ordering for content-addressed release inputs.
 *
 * Locale collation is intended for display and can vary by runtime. Release
 * digests instead need one platform-independent ordering.
 */
export function compareCanonicalText(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
