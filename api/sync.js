import { randomUUID } from 'node:crypto'
import { accountHash, bearer, credentialHash, verifyAccount } from '../lib/security.js'
import { deletePrivate, readPrivateJson, writePrivateJson } from '../lib/blob-store.js'

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } }

const json = (response, status, body) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  return response.end(JSON.stringify(body))
}

export default async function handler(request, response) {
  const { accountId } = request.method === 'GET' ? request.query : request.body || {}
  if (!/^[0-9a-f-]{36}$/i.test(accountId || '')) return json(response, 400, { error: 'ID DAYLY non valido.' })
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'Metodo non supportato.' })
  const root = `users/${accountHash(accountId)}`
  let metadata = await readPrivateJson(`${root}/meta.json`)
  const credential = bearer(request)
  if (!metadata && (request.method === 'PUT' || request.method === 'POST') && credential.length >= 40) {
    metadata = { credentialHash: credentialHash(credential), revision: null, tokenVersion: 0 }
    await writePrivateJson(`${root}/meta.json`, metadata)
  }
  if (!await verifyAccount(request, accountId, metadata)) return json(response, 401, { error: 'Collegamento DAYLY non valido.' })

  if (request.method === 'GET') {
    const document = await readPrivateJson(`${root}/snapshot.json`)
    return json(response, 200, { snapshot: document?.snapshot || null, revision: metadata.revision || null })
  }

  if (request.method === 'DELETE') {
    if (await readPrivateJson(`${root}/snapshot.json`)) await deletePrivate(`${root}/snapshot.json`)
    await deletePrivate(`${root}/meta.json`)
    return json(response, 200, { deleted: true })
  }

  if (request.method === 'POST') {
    const nextCredential = request.body?.newCredential
    if (typeof nextCredential !== 'string' || nextCredential.length < 40 || nextCredential.length > 200) return json(response, 400, { error: 'Nuovo codice di collegamento non valido.' })
    metadata = { ...metadata, credentialHash: credentialHash(nextCredential), tokenVersion: (metadata.tokenVersion || 0) + 1 }
    await writePrivateJson(`${root}/meta.json`, metadata)
    return json(response, 200, { disconnected: true, tokenVersion: metadata.tokenVersion })
  }

  const snapshot = request.body?.snapshot
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.iv !== 'string' || typeof snapshot.data !== 'string' || snapshot.data.length > 2_000_000) {
    return json(response, 400, { error: 'Backup cifrato non valido.' })
  }
  const expectedRevision = request.body.revision || null
  if ((metadata.revision || null) !== expectedRevision) return json(response, 409, { error: 'I dati online sono cambiati. Ricarica la copia più recente prima di salvare.', revision: metadata.revision || null })
  const revision = `${Date.now()}-${randomUUID()}`
  await writePrivateJson(`${root}/snapshot.json`, { snapshot, updatedAt: Date.now() })
  metadata = { ...metadata, revision }
  await writePrivateJson(`${root}/meta.json`, metadata)
  return json(response, 200, { revision })
}
