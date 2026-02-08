export const isSlug = (input: string): boolean => /^[a-z0-9][a-z0-9_-]{1,39}$/.test(input)

export const parseTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
}

export const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const asNullableString = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') return null
  return value.trim() || null
}

export const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
