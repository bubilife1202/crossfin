import { Hono } from 'hono'
import type { Env } from '../types'

type DocsDeps = {
  getGuidePayload: () => unknown
  getOpenApiPayload: () => unknown
}

export function createDocsRoutes(deps: DocsDeps): Hono<Env> {
  const docs = new Hono<Env>()

  docs.get('/api/docs/guide', (c) => c.json(deps.getGuidePayload()))
  docs.get('/api/openapi.json', (c) => c.json(deps.getOpenApiPayload()))

  return docs
}
