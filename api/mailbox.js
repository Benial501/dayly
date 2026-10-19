import { randomUUID } from 'node:crypto'
import { accountHash, verifyAccount } from '../lib/security.js'
import { readPrivateJson, writePrivateJson } from '../lib/blob-store.js'

const json = (response, status, body) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  return response.end(JSON.stringify(body))
}

const validEnvelope = (value) =>
  value === null ||
  (!!value && value.version === 1 && typeof value.iv === 'string' && typeof value.data === 'string' && value.data.length <= 200_000)

export default async function handler(request, response) {
  // la casella è cifrata con la chiave del dispositivo: il server non può
  // rileggerla né ripulirla da solo, quindi archiviare vuol dire che l'app
  // rimanda su la casella senza la mail che hai archiviato
  if (!['GET', 'PUT'].includes(request.method)) return json(response, 405, { error: 'Metodo non supportato.' })

  const { accountId } = request.method === 'GET' ? request.query : request.body || {}
  if (!/^[0-9a-f-]{36}$/i.test(accountId || '')) return json(response, 400, { error: 'ID DAYLY non valido.' })

  const root = `users/${accountHash(accountId)}`
  const metadata = await readPrivateJson(`${root}/meta.json`)
  if (!await verifyAccount(request, accountId, metadata)) return json(response, 401, { error: 'Collegamento DAYLY non valido.' })

  const document = await readPrivateJson(`${root}/mailbox.json`)

  if (request.method === 'GET') {
    return json(response, 200, { casella: document?.casella || null, revision: document?.revision || null })
  }

  const casella = request.body?.casella ?? null
  if (!validEnvelope(casella)) return json(response, 400, { error: 'Casella cifrata non valida.' })
  if ((document?.revision || null) !== (request.body?.revision || null)) {
    return json(response, 409, { error: 'La casella è cambiata altrove. Ricaricala prima di archiviare.', revision: document?.revision || null })
  }

  const revision = `${Date.now()}-${randomUUID()}`
  await writePrivateJson(`${root}/mailbox.json`, { casella, revision, updatedAt: Date.now() })
  return json(response, 200, { revision })
}
