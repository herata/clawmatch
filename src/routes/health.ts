import type { Elysia } from 'elysia'

export const registerHealthRoutes = (app: Elysia): void => {
  app.get('/health', () => ({ ok: true, service: 'openclaw-bot-arena' }))
}
