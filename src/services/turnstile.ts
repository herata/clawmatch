import type { RuntimeEnv } from '../types/runtime'

export const verifyTurnstile = async (
  env: RuntimeEnv,
  token: string | null | undefined,
  remoteip: string
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  if (!env.TURNSTILE_SECRET) {
    return { ok: true }
  }

  if (!token) {
    return { ok: false, reason: 'turnstile_token_required' }
  }

  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET)
  form.set('response', token)
  form.set('remoteip', remoteip)

  let response: Response
  try {
    response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
  } catch {
    return { ok: false, reason: 'turnstile_unreachable' }
  }

  if (!response.ok) {
    return { ok: false, reason: 'turnstile_rejected' }
  }

  const payload = (await response.json()) as { success?: boolean }
  if (!payload.success) {
    return { ok: false, reason: 'turnstile_failed' }
  }

  return { ok: true }
}
