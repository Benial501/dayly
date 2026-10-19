import { accountHash, verifyAccount } from '../lib/security.js'
import { readPrivateJson, writePrivateJson } from '../lib/blob-store.js'

const WEEK = 7 * 24 * 60 * 60 * 1000

const json = (response, status, body) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  return response.end(JSON.stringify(body))
}

export default async function handler(request, response) {
  if (!['GET', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'Metodo non supportato.' })

  const { accountId, id } = request.method === 'GET' ? request.query : request.body || {}
  if (!/^[0-9a-f-]{36}$/i.test(accountId || '')) return json(response, 400, { error: 'ID DAYLY non valido.' })

  const root = `users/${accountHash(accountId)}`
  const metadata = await readPrivateJson(`${root}/meta.json`)
  if (!await verifyAccount(request, accountId, metadata)) return json(response, 401, { error: 'Collegamento DAYLY non valido.' })

  const now = Date.now()
  const stored = (await readPrivateJson(`${root}/proposals.json`))?.proposte || []
  const alive = stored.filter(item => now - Number(item.createdAt || 0) < WEEK)

  if (request.method === 'GET') {
    if (alive.length !== stored.length) await writePrivateJson(`${root}/proposals.json`, { proposte: alive })
    return json(response, 200, { proposte: alive })
  }

  const remaining = id === '*' ? [] : alive.filter(item => item.id !== id)
  await writePrivateJson(`${root}/proposals.json`, { proposte: remaining })
  return json(response, 200, { rimaste: remaining.length })
}
