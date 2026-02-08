import type { TurnModerationState } from '../types/runtime'

const BANNED_PATTERNS = [/\bkill yourself\b/i, /\bnazi\b/i, /\bfuck\b/i]

export type ModerationResult = {
  state: TurnModerationState
  publicContent: string
  reason?: string
}

export const moderateContent = (content: string): ModerationResult => {
  if (content.length > 800) {
    return { state: 'masked', publicContent: '[moderated]', reason: 'too_long' }
  }

  const urlCount = (content.match(/https?:\/\//g) ?? []).length
  if (urlCount > 3) {
    return { state: 'masked', publicContent: '[moderated]', reason: 'too_many_urls' }
  }

  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      return { state: 'masked', publicContent: '[moderated]', reason: 'banned_pattern' }
    }
  }

  return { state: 'clear', publicContent: content }
}
