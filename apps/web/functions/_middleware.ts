export async function onRequest(context: { request: Request; next: () => Promise<Response> }) {
  const url = new URL(context.request.url)
  const host = url.hostname.toLowerCase()

  if (host === 'crossfin.pages.dev' || host.endsWith('.crossfin.pages.dev')) {
    url.protocol = 'https:'
    url.hostname = 'crossfin.dev'
    return Response.redirect(url.toString(), 301)
  }

  return context.next()
}
