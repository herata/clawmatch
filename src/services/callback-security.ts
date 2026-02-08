const PRIVATE_IPV4_PATTERNS = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[0-1])\./, /^192\.168\./, /^0\./]

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const isPrivateIpv4 = (hostname: string): boolean => {
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))
}

const isLikelyIpv6Local = (hostname: string): boolean => {
  return hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname === '::1'
}

export const validateCallbackUrl = (candidate: string): { ok: true } | { ok: false; reason: string } => {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' }
  }

  if (PRIVATE_HOSTS.has(url.hostname) || isPrivateIpv4(url.hostname) || isLikelyIpv6Local(url.hostname)) {
    return { ok: false, reason: 'private_host_not_allowed' }
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'basic_auth_not_allowed' }
  }

  return { ok: true }
}
