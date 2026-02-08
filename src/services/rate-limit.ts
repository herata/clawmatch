type Counter = {
  count: number
  resetAt: number
}

const bucket = new Map<string, Counter>()

export const takeRateLimit = (key: string, limit: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } => {
  const now = Date.now()
  const current = bucket.get(key)

  if (!current || current.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (current.count >= limit) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000)
    return { ok: false, retryAfterSec }
  }

  current.count += 1
  return { ok: true }
}
