import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'
import { accountHash, bearer, credentialHash, verifyToken } from '../lib/security.js'
import { readPrivateJson, writePrivateJson } from '../lib/blob-store.js'

const WEEK = 7 * 24 * 60 * 60 * 1000
const MAIL_IN_VIEW = 20
const MAIL_ARCHIVED = 100
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const fail = (response, status, body) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify(body)) }
function decryptSnapshot(envelope, key) {
  const rawKey = Buffer.from(key, 'base64url')
  const iv = Buffer.from(envelope.iv, 'base64url')
  const bytes = Buffer.from(envelope.data, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(bytes.subarray(bytes.length - 16))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'))
}
function encryptSnapshot(data, key) {
  const rawKey = Buffer.from(key, 'base64url')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', rawKey, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { version: 1, iv: iv.toString('base64url'), data: encrypted.toString('base64url') }
}
async function loadUser(claims) {
  const root = `users/${accountHash(claims.sub)}`
  const metadata = await readPrivateJson(`${root}/meta.json`)
  if (!metadata || metadata.tokenVersion !== claims.tokenVersion || metadata.credentialHash !== credentialHash(claims.accountKey)) return null
  const document = await readPrivateJson(`${root}/snapshot.json`)
  if (!document?.snapshot) return { root, metadata, data: { tasks: [], projects: [], ideas: [], reviews: [], settings: [] } }
  return { root, metadata, data: decryptSnapshot(document.snapshot, claims.accountKey) }
}
async function saveUser(user, data) {
  const currentMetadata = await readPrivateJson(`${user.root}/meta.json`)
  if (!currentMetadata || currentMetadata.revision !== user.metadata.revision || currentMetadata.tokenVersion !== user.metadata.tokenVersion) throw new Error('I dati DAYLY sono cambiati in un’altra sessione. Ricarica DAYLY e riprova.')
  const snapshot = encryptSnapshot(data, user.accountKey)
  const revision = `${Date.now()}-${randomBytes(8).toString('hex')}`
  await writePrivateJson(`${user.root}/snapshot.json`, { snapshot, updatedAt: Date.now() })
  await writePrivateJson(`${user.root}/meta.json`, { ...currentMetadata, revision })
}
const line = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
const isLink = (value) => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value)
const sameMail = (a, b) => (a.link && b.link ? a.link === b.link : a.mittente === b.mittente && a.oggetto === b.oggetto)
async function readMailbox(user) {
  const document = await readPrivateJson(`${user.root}/mailbox.json`)
  if (!document?.casella) return []
  const list = decryptSnapshot(document.casella, user.accountKey)
  return Array.isArray(list) ? list : []
}
async function writeMailbox(user, list) {
  const revision = `${Date.now()}-${randomBytes(8).toString('hex')}`
  await writePrivateJson(`${user.root}/mailbox.json`, { casella: encryptSnapshot(list, user.accountKey), revision, updatedAt: Date.now() })
}
function errorResponse(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } } }
function success(id, result) { return { jsonrpc: '2.0', id, result } }

const tools = [
  { name: 'dayly_leggi_dati', description: 'Legge attività, progetti, idee e riepiloghi salvati dall’utente in DAYLY. Usa questi dati solo per la richiesta corrente.', inputSchema: { type: 'object', properties: { periodo: { type: 'string', enum: ['oggi', 'settimana', 'tutti'], description: 'Seleziona quali attività includere.' } } } },
  { name: 'dayly_proponi_modifiche', description: 'Invia a DAYLY una lista di modifiche proposte. Non cambia i dati: l’utente le trova nell’app come schede da accettare o rifiutare una per una. Usa questo strumento quando l’utente ti chiede di organizzargli qualcosa, poi digli che le proposte lo aspettano in DAYLY.', inputSchema: { type: 'object', properties: { nota: { type: 'string', description: 'Una frase che spiega all’utente cosa hai proposto e perché.' }, modifiche: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: ['aggiungi_attivita','sposta_attivita','aggiorna_progresso','completa_attivita'] }, titolo: { type: 'string' }, data: { type: 'string' }, ora: { type: 'string' }, priorita: { type: 'boolean' }, progetto: { type: 'string' }, progresso: { type: 'number' } }, required: ['tipo'] } } }, required: ['modifiche'] } },
  { name: 'dayly_segnala_email', description: 'Deposita in DAYLY il riassunto delle email importanti che l’utente deve vedere. L’app non mostra il messaggio originale né il suo oggetto: mostra il tuo riassunto, cioè cosa dice l’email in una o due frasi. Da lì l’utente apre l’email vera in Gmail, la trasforma in attività o la archivia. Non modifica i dati DAYLY. Riassumi con parole tue: non incollare il testo integrale del messaggio. Dopo averlo usato, di’ all’utente che i riassunti lo aspettano in DAYLY invece di rielencarli in chat.', inputSchema: { type: 'object', properties: { nota: { type: 'string', description: 'Una frase che spiega all’utente perché ha senso guardare queste email adesso.' }, email: { type: 'array', description: 'Da una a venti email, dalla più importante.', items: { type: 'object', properties: { riassunto: { type: 'string', description: 'Cosa dice l’email, in una o due frasi con parole tue. È l’unica cosa che l’utente legge nell’app: scrivila in modo autosufficiente, dicendo chi scrive e cosa chiede.' }, mittente: { type: 'string', description: 'Chi scrive: nome o indirizzo. Serve a riconoscere i doppioni, non viene mostrato.' }, oggetto: { type: 'string', description: 'L’oggetto del messaggio. Serve a riconoscere i doppioni e a dare un titolo all’attività, non viene mostrato.' }, motivo: { type: 'string', description: 'Perché è importante, in una frase, se aggiunge qualcosa al riassunto.' }, ricevuta: { type: 'string', description: 'Giorno in cui è arrivata, in formato AAAA-MM-GG. DAYLY tiene in vista le email di oggi e archivia da sola quelle dei giorni passati.' }, scadenza: { type: 'string', description: 'Entro quando va gestita, in formato AAAA-MM-GG, se il messaggio lo dice.' }, link: { type: 'string', description: 'Link https al messaggio in Gmail (per esempio https://mail.google.com/mail/u/0/#inbox/<id>), così il tocco apre l’app Gmail sul messaggio giusto.' } }, required: ['riassunto','mittente','oggetto'] } } }, required: ['email'] } },
  { name: 'dayly_applica_modifiche', description: 'Applica in DAYLY le modifiche già mostrate all’utente solo dopo che ha scritto chiaramente che le conferma. Ripeti la frase di conferma nella motivazione; se non ha confermato, non chiamare questo strumento.', inputSchema: { type: 'object', properties: { motivazione: { type: 'string', description: 'Frase esplicita di conferma dell’utente nella conversazione corrente.' }, modifiche: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: ['aggiungi_attivita','sposta_attivita','aggiorna_progresso','completa_attivita'] }, titolo: { type: 'string' }, data: { type: 'string' }, ora: { type: 'string' }, progetto: { type: 'string' }, progresso: { type: 'number' } }, required: ['tipo'] } } }, required: ['motivazione','modifiche'] } },
]

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  const claims = verifyToken(bearer(request), 'access')
  if (!claims || claims.aud !== 'https://dayly-delta.vercel.app/api/mcp') {
    response.setHeader('WWW-Authenticate', 'Bearer resource_metadata="https://dayly-delta.vercel.app/.well-known/oauth-protected-resource", scope="dayly:read dayly:write"')
    return fail(response, 401, { error: 'Autorizzazione Claude richiesta.' })
  }
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return fail(response, 405, { error: 'Usa richieste MCP POST.' }) }
  const user = await loadUser(claims)
  if (!user) return fail(response, 401, { error: 'Autorizzazione revocata o account non disponibile.' })
  user.accountKey = claims.accountKey
  const body = request.body || {}
  const { id, method, params = {} } = body
  if (body.jsonrpc !== '2.0' || typeof method !== 'string') return fail(response, 400, errorResponse(id ?? null, -32600, 'Richiesta MCP non valida.'))

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return response.status(202).end()
  if (method === 'initialize') return response.status(200).json(success(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'DAYLY', version: '1.0.0' }, instructions: 'Rispondi in italiano. Leggi i dati solo se servono per la richiesta. Prima di applicare qualunque cambiamento, mostra una proposta chiara e chiedi conferma esplicita; senza conferma usa solo strumenti di lettura o proposta.' }))
  if (method === 'ping') return response.status(200).json(success(id, {}))
  if (method === 'tools/list') return response.status(200).json(success(id, { tools }))
  if (method !== 'tools/call') return response.status(200).json(errorResponse(id, -32601, 'Metodo MCP non supportato.'))

  const name = params.name
  const args = params.arguments || {}
  if (name === 'dayly_applica_modifiche' && !String(claims.scope || '').split(' ').includes('dayly:write')) return response.status(200).json(errorResponse(id, -32003, 'Il connettore non ha il permesso di scrivere.'))
  if (['dayly_leggi_dati', 'dayly_proponi_modifiche', 'dayly_segnala_email'].includes(name) && !String(claims.scope || '').split(' ').includes('dayly:read')) return response.status(200).json(errorResponse(id, -32003, 'Il connettore non ha il permesso di leggere.'))
  if (name === 'dayly_leggi_dati') {
    let result = user.data
    if (args.periodo === 'oggi') {
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      result = { tasks: user.data.tasks.filter(item => item.date === today), projects: user.data.projects, ideas: [], reviews: [] }
    } else if (args.periodo === 'settimana') {
      const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); start.setHours(0,0,0,0)
      const end = new Date(start); end.setDate(end.getDate() + 7)
      result = { tasks: user.data.tasks.filter(item => { const d = new Date(`${item.date}T00:00:00`); return d >= start && d < end }), projects: user.data.projects, ideas: user.data.ideas, reviews: user.data.reviews }
    }
    return response.status(200).json(success(id, text(result)))
  }
  if (name === 'dayly_proponi_modifiche') {
    const proposed = (Array.isArray(args.modifiche) ? args.modifiche : []).slice(0, 20)
    if (!proposed.length) return response.status(200).json(success(id, { ...text('Serve almeno una modifica da proporre.'), isError: true }))
    const now = Date.now()
    const stored = (await readPrivateJson(`${user.root}/proposals.json`))?.proposte || []
    const kept = stored.filter(item => now - Number(item.createdAt || 0) < WEEK).slice(-10)
    const proposal = {
      id: randomBytes(8).toString('hex'),
      createdAt: now,
      nota: typeof args.nota === 'string' ? args.nota.slice(0, 300) : '',
      modifiche: proposed,
    }
    try { await writePrivateJson(`${user.root}/proposals.json`, { proposte: [...kept, proposal] }) }
    catch { return response.status(200).json(success(id, { ...text('Non sono riuscito a inviare la proposta a DAYLY.'), isError: true })) }
    return response.status(200).json(success(id, text({
      stato: 'Proposta inviata a DAYLY. Nessun dato è stato modificato.',
      inviate: proposed.length,
      messaggio: 'Di’ all’utente che le proposte lo aspettano in DAYLY, dove le accetta o le rifiuta una per una. Non chiedere conferma in chat per queste.',
    })))
  }
  if (name === 'dayly_segnala_email') {
    const incoming = (Array.isArray(args.email) ? args.email : []).slice(0, MAIL_IN_VIEW)
    const nota = typeof args.nota === 'string' ? args.nota.slice(0, 300) : ''
    const reported = incoming.map(item => ({
      riassunto: line(item.riassunto, 400),
      mittente: line(item.mittente, 120),
      oggetto: line(item.oggetto, 200),
      motivo: line(item.motivo, 300),
      ricevuta: isDay(item.ricevuta) ? item.ricevuta : '',
      scadenza: isDay(item.scadenza) ? item.scadenza : '',
      link: isLink(item.link) ? item.link.slice(0, 500) : '',
    })).filter(item => item.riassunto && item.mittente && item.oggetto)
    if (!reported.length) return response.status(200).json(success(id, { ...text('Serve almeno una email con riassunto, mittente e oggetto.'), isError: true }))
    const now = Date.now()
    let mailbox = []
    try { mailbox = await readMailbox(user) } catch { return response.status(200).json(success(id, { ...text('Non sono riuscito ad aprire la casella DAYLY.'), isError: true })) }
    // l'archivio resta finché l'utente non lo svuota dall'app; in vista tengo
    // solo i riassunti freschi, e una email risegnalata torna in vista
    const archived = mailbox.filter(item => item.stato === 'archiviata')
    let live = mailbox.filter(item => item.stato !== 'archiviata' && now - Number(item.createdAt || 0) < WEEK)
    for (const mail of reported) {
      const previous = live.find(item => sameMail(item, mail)) || archived.find(item => sameMail(item, mail))
      const mailId = previous?.id || randomBytes(8).toString('hex')
      live = live.filter(item => item.id !== mailId)
      const buried = archived.findIndex(item => item.id === mailId)
      if (buried >= 0) archived.splice(buried, 1)
      live.push({ id: mailId, createdAt: now, nota, stato: 'nuova', ...mail })
    }
    try { await writeMailbox(user, [...archived.slice(-MAIL_ARCHIVED), ...live.slice(-MAIL_IN_VIEW)]) }
    catch { return response.status(200).json(success(id, { ...text('Non sono riuscito a consegnare le email a DAYLY.'), isError: true })) }
    return response.status(200).json(success(id, text({
      stato: 'Riassunti consegnati a DAYLY. Nessun dato è stato modificato.',
      consegnate: reported.length,
      messaggio: 'Di’ all’utente che i riassunti lo aspettano in DAYLY, dove apre l’email in Gmail, la trasforma in attività o la archivia. Non rielencarli in chat.',
    })))
  }
  if (name === 'dayly_applica_modifiche') {
    if (typeof args.motivazione !== 'string' || args.motivazione.trim().length < 3) return response.status(200).json(success(id, { ...text('Serve una conferma esplicita dell’utente prima di procedere.'), isError: true }))
    const changes = Array.isArray(args.modifiche) ? args.modifiche.slice(0, 20) : []
    const applied = []
    for (const change of changes) {
      if (change.tipo === 'aggiungi_attivita' && typeof change.titolo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(change.data || '')) {
        user.data.tasks.push({ id: randomBytes(16).toString('hex'), title: change.titolo.slice(0,160), date: change.data, time: /^\d{2}:\d{2}$/.test(change.ora || '') ? change.ora : '', priority: false, done: false, updatedAt: Date.now() }); applied.push(change.titolo)
      } else if (change.tipo === 'sposta_attivita') {
        const task = user.data.tasks.find(item => item.title === change.titolo)
        if (task && /^\d{4}-\d{2}-\d{2}$/.test(change.data || '')) { task.date = change.data; task.time = /^\d{2}:\d{2}$/.test(change.ora || '') ? change.ora : ''; task.updatedAt = Date.now(); applied.push(task.title) }
      } else if (change.tipo === 'aggiorna_progresso') {
        const project = user.data.projects.find(item => item.title === change.progetto)
        if (project && Number.isFinite(Number(change.progresso))) { project.progress = Math.max(0, Math.min(100, Number(change.progresso))); applied.push(project.title) }
      } else if (change.tipo === 'completa_attivita') {
        const task = user.data.tasks.find(item => item.title === change.titolo)
        if (task) { task.done = true; task.updatedAt = Date.now(); applied.push(task.title) }
      }
    }
    try { await saveUser(user, user.data) } catch (error) { return response.status(200).json(success(id, { ...text(error.message), isError: true })) }
    return response.status(200).json(success(id, text({ applicate: applied, messaggio: 'Modifiche salvate in DAYLY; si sincronizzeranno sul telefono alla prossima apertura con Internet.' })))
  }
  return response.status(200).json(errorResponse(id, -32602, 'Strumento non riconosciuto.'))
}
