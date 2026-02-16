import rawCatalog from '../../../catalog/crossfin-catalog.json'

export type CatalogEndpoint = {
  id: string
  name: string
  description: string
  category: string
  path: string
  sampleQuery?: string
  price: string
  tags: string[]
  playgroundLabel: string
}

export type CatalogData = {
  apiVersion: string
  mcpTools: string[]
  freePlaygroundEndpoints: Array<{ path: string; label: string }>
  paidEndpoints: CatalogEndpoint[]
}

const catalog = rawCatalog as CatalogData

export const CROSSFIN_API_VERSION = catalog.apiVersion
export const CROSSFIN_MCP_TOOLS = catalog.mcpTools
export const CROSSFIN_FREE_PLAYGROUND_ENDPOINTS = catalog.freePlaygroundEndpoints
export const CROSSFIN_PAID_ENDPOINTS = catalog.paidEndpoints

export const CROSSFIN_PAID_PRICING: Record<string, string> = Object.fromEntries(
  CROSSFIN_PAID_ENDPOINTS.map((entry) => [entry.path, entry.price]),
)

export function withSampleQuery(path: string, sampleQuery?: string): string {
  if (!sampleQuery) return path
  return `${path}?${sampleQuery}`
}
