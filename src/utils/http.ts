export const jsonResponse = (status: number, body: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  })
}

export const getClientIp = (request: Request): string => {
  const forwarded = request.headers.get('cf-connecting-ip')
  if (forwarded) return forwarded
  const xForwarded = request.headers.get('x-forwarded-for')
  if (xForwarded) return xForwarded.split(',')[0]?.trim() ?? 'unknown'
  return 'unknown'
}
