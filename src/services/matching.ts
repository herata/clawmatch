import type { BotRow } from '../types/db'

type PairScore = {
  botAId: string
  botBId: string
  score: number
}

const parseTags = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
  } catch {
    return []
  }
}

const jaccard = (a: string[], b: string[]): number => {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0.5

  let intersect = 0
  for (const value of setA) {
    if (setB.has(value)) intersect += 1
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersect / union
}

const freshnessScore = (bot: BotRow): number => {
  const updated = new Date(bot.updated_at).getTime()
  const ageHours = Math.max(0, (Date.now() - updated) / 3_600_000)
  return 1 / (1 + ageHours / 24)
}

const computeScore = (a: BotRow, b: BotRow): number => {
  const tagsA = parseTags(a.tags_json)
  const tagsB = parseTags(b.tags_json)
  const tag = jaccard(tagsA, tagsB)
  const freshness = (freshnessScore(a) + freshnessScore(b)) / 2
  const random = Math.random()
  return Number((0.7 * tag + 0.2 * freshness + 0.1 * random).toFixed(5))
}

export const pickMatchPair = (bots: BotRow[], epsilon = 0.25): PairScore | null => {
  if (bots.length < 2) return null

  const candidates: PairScore[] = []
  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      candidates.push({
        botAId: bots[i].id,
        botBId: bots[j].id,
        score: computeScore(bots[i], bots[j]),
      })
    }
  }

  if (candidates.length === 0) return null

  if (Math.random() < epsilon) {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  candidates.sort((left, right) => right.score - left.score)
  return candidates[0]
}
