export const nowIso = (): string => new Date().toISOString()

export const addMinutes = (iso: string, minutes: number): string => {
  const base = new Date(iso).getTime()
  return new Date(base + minutes * 60_000).toISOString()
}

export const addSeconds = (iso: string, seconds: number): string => {
  const base = new Date(iso).getTime()
  return new Date(base + seconds * 1_000).toISOString()
}

export const isExpired = (expiresAt: string, refIso = nowIso()): boolean => {
  return new Date(expiresAt).getTime() <= new Date(refIso).getTime()
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
