import { accountHash, bearer, credentialHash, verifyAccount, signToken } from '../lib/security.js'
import { readPrivateJson } from '../lib/blob-store.js'

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (request.method !== 'POST') return response.status(405).json({ error: 'Metodo non supportato.' })
  const accountId = request.body?.accountId
  if (!/^[0-9a-f-]{36}$/i.test(accountId || '')) return response.status(400).json({ error: 'ID DAYLY non valido.' })
  const metadata = await readPrivateJson(`users/${accountHash(accountId)}/meta.json`)
  if (!metadata || !await verifyAccount(request, accountId, metadata)) return response.status(401).json({ error: 'Prima attiva la sincronizzazione DAYLY.' })
  const credential = bearer(request)
  if (credentialHash(credential) !== metadata.credentialHash) return response.status(401).json({ error: 'Collegamento DAYLY non valido.' })
  const pairingCode = signToken({ type: 'pair', sub: accountId, accountKey: credential, tokenVersion: metadata.tokenVersion || 0, exp: Math.floor(Date.now() / 1000) + 5 * 60 })
  return response.status(200).json({ code: pairingCode, expiresIn: 300 })
}
