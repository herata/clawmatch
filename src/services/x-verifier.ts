import type { RuntimeEnv } from '../types/runtime'

export type XVerifySuccess = {
  ok: true
  subject: string
  handle: string
  displayName: string
  postId: string
  postCreatedAt: string
  raw: unknown
}

export type XVerifyFailure = {
  ok: false
  kind: 'invalid' | 'temporary'
  reason: string
}

export type XVerifyResult = XVerifySuccess | XVerifyFailure

export const extractPostId = (postUrl: string): string | null => {
  let url: URL
  try {
    url = new URL(postUrl)
  } catch {
    return null
  }

  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
    return null
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const statusIndex = parts.findIndex((part) => part === 'status')
  if (statusIndex < 0) return null
  const postId = parts[statusIndex + 1]
  if (!postId || !/^\d+$/.test(postId)) return null
  return postId
}

const isTemporaryStatus = (status: number): boolean => status === 429 || status >= 500

export const verifyXPost = async (env: RuntimeEnv, postUrl: string, requiredText: string): Promise<XVerifyResult> => {
  const postId = extractPostId(postUrl)
  if (!postId) {
    return { ok: false, kind: 'invalid', reason: 'invalid_post_url' }
  }

  if (!env.X_BEARER_TOKEN) {
    return { ok: false, kind: 'temporary', reason: 'x_api_token_missing' }
  }

  const base = env.X_API_BASE?.trim() || 'https://api.x.com'
  const requestUrl = new URL(`${base.replace(/\/$/, '')}/2/tweets/${postId}`)
  requestUrl.searchParams.set('expansions', 'author_id')
  requestUrl.searchParams.set('tweet.fields', 'created_at,text')
  requestUrl.searchParams.set('user.fields', 'username,name,protected')

  let response: Response
  try {
    response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
      },
    })
  } catch {
    return { ok: false, kind: 'temporary', reason: 'x_api_unreachable' }
  }

  if (!response.ok) {
    if (isTemporaryStatus(response.status)) {
      return { ok: false, kind: 'temporary', reason: `x_api_status_${response.status}` }
    }
    return { ok: false, kind: 'invalid', reason: `x_api_status_${response.status}` }
  }

  const payload = (await response.json()) as {
    data?: { id: string; text: string; created_at?: string; author_id?: string }
    includes?: { users?: Array<{ id: string; username: string; name: string; protected?: boolean }> }
  }

  if (!payload.data?.id || !payload.data.text || !payload.data.author_id) {
    return { ok: false, kind: 'invalid', reason: 'x_payload_missing_fields' }
  }

  const author = payload.includes?.users?.find((user) => user.id === payload.data?.author_id)
  if (!author) {
    return { ok: false, kind: 'invalid', reason: 'x_author_missing' }
  }

  if (author.protected) {
    return { ok: false, kind: 'invalid', reason: 'protected_account_not_allowed' }
  }

  const normalized = payload.data.text.trim().replace(/\s+/g, ' ')
  if (normalized !== requiredText) {
    return { ok: false, kind: 'invalid', reason: 'required_text_mismatch' }
  }

  return {
    ok: true,
    subject: author.id,
    handle: author.username,
    displayName: author.name,
    postId: payload.data.id,
    postCreatedAt: payload.data.created_at ?? new Date().toISOString(),
    raw: payload,
  }
}
