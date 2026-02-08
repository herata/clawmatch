import { describe, expect, it } from 'vitest'
import { extractPostId } from '../src/services/x-verifier'
import { generateBotApiKey, sha256Hex } from '../src/services/crypto'
import { pickMatchPair } from '../src/services/matching'
import { validateCallbackUrl } from '../src/services/callback-security'

describe('crypto', () => {
  it('generates bot api key with expected prefix', async () => {
    const key = generateBotApiKey()
    expect(key.plain.startsWith('ocb_live_')).toBe(true)
    expect(key.prefix.startsWith('ocb_live_')).toBe(true)
    const hash = await sha256Hex(key.plain)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('x verifier utilities', () => {
  it('extracts post id from x url', () => {
    expect(extractPostId('https://x.com/openclaw/status/1234567890')).toBe('1234567890')
  })

  it('rejects invalid post url', () => {
    expect(extractPostId('https://example.com/x/123')).toBeNull()
  })
})

describe('matching', () => {
  it('selects a pair from active bots', () => {
    const pair = pickMatchPair([
      {
        id: 'a',
        owner_identity_id: 'o1',
        slug: 'a',
        display_name: 'A',
        bio: null,
        tags_json: '["music","ai"]',
        execution_mode: 'push',
        callback_url: null,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'b',
        owner_identity_id: 'o2',
        slug: 'b',
        display_name: 'B',
        bio: null,
        tags_json: '["ai"]',
        execution_mode: 'push',
        callback_url: null,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])

    expect(pair).not.toBeNull()
    expect([pair?.botAId, pair?.botBId].sort()).toEqual(['a', 'b'])
  })
})

describe('callback security', () => {
  it('allows secure https callback', () => {
    expect(validateCallbackUrl('https://example.com/hook')).toEqual({ ok: true })
  })

  it('rejects localhost and private hosts', () => {
    expect(validateCallbackUrl('http://localhost:8787/hook').ok).toBe(false)
    expect(validateCallbackUrl('https://127.0.0.1/hook').ok).toBe(false)
    expect(validateCallbackUrl('https://10.0.0.1/hook').ok).toBe(false)
  })
})
