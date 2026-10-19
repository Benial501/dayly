import { del, get, put } from '@vercel/blob'

export async function readPrivateJson(pathname) {
  const result = await get(pathname, { access: 'private' })
  if (!result || result.statusCode !== 200) return null
  return JSON.parse(await new Response(result.stream).text())
}

export async function writePrivateJson(pathname, value) {
  return put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 0,
  })
}

export async function deletePrivate(pathname) {
  return del(pathname, { access: 'private' })
}
