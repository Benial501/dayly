import { createHash, randomUUID } from 'node:crypto'
import { accountHash, credentialHash, signToken, verifyToken } from '../../lib/security.js'
import { readPrivateJson, writePrivateJson } from '../../lib/blob-store.js'

const callbackHosts = new Set(['claude.ai'])
const baseUrl = () => process.env.DAYLY_BASE_URL || 'https://dayly-delta.vercel.app'
const sendJson = (response, status, body) => { response.setHeader('Cache-Control', 'no-store'); return response.status(status).json(body) }
const readBody = (request) => {
  if (request.body && typeof request.body === 'object') return request.body
  const params = new URLSearchParams(String(request.body || ''))
  return Object.fromEntries(params)
}
function safeRedirect(value) {
  try {
    const url = new URL(value)
    return callbackHosts.has(url.hostname) && url.pathname === '/api/mcp/auth_callback' && url.protocol === 'https:' ? url : null
  } catch { return null }
}
function verifyPkce(verifier, challenge) {
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) return false
  const digest = createHash('sha256').update(verifier).digest('base64url')
  return digest === challenge
}

export default async function handler(request, response) {
  const path = `/${(request.query.path || []).join('/')}`
  const issuer = baseUrl()
  if (request.method === 'OPTIONS') return response.status(204).setHeader('Allow', 'GET, POST, OPTIONS').end()

  if (path === '/authorization-server') return sendJson(response, 200, {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['dayly:read', 'dayly:write'],
  })
  if (path === '/protected-resource') return sendJson(response, 200, {
    resource: `${issuer}/api/mcp`, authorization_servers: [issuer], scopes_supported: ['dayly:read', 'dayly:write'],
  })

  if (path === '/register' && request.method === 'POST') {
    const body = readBody(request)
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.some(uri => safeRedirect(uri))) return sendJson(response, 400, { error: 'invalid_redirect_uri' })
    return sendJson(response, 201, { client_id: `dayly-${randomUUID()}`, client_name: String(body.client_name || 'Claude'), redirect_uris: body.redirect_uris.filter(uri => safeRedirect(uri)), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  }

  if (path === '/authorize' && request.method === 'GET') {
    const params = new URLSearchParams(request.url.split('?')[1] || '')
    const redirect = safeRedirect(params.get('redirect_uri'))
    if (params.get('response_type') !== 'code' || !redirect || !params.get('code_challenge') || params.get('code_challenge_method') !== 'S256') return response.status(400).send('Richiesta OAuth non valida.')
    const fields = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource']
      .map(key => `<input type="hidden" name="${key}" value="${String(params.get(key) || '').replaceAll('&','&amp;').replaceAll('"','&quot;')}">`).join('')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).send(`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega DAYLY</title><body style="margin:0;background:#f2f8fa;color:#17384f;font:16px system-ui;min-height:100vh;display:grid;place-items:center"><main style="background:white;padding:28px;border-radius:18px;max-width:420px;margin:20px;box-shadow:0 12px 40px #145d7a18"><h1>Collega DAYLY a Claude</h1><p>Apri DAYLY su iPhone, genera un codice per Claude e incollalo qui. Il codice scade dopo cinque minuti. Claude potrà leggere i tuoi dati e applicare solo le modifiche che gli confermi.</p><form method="post" action="/api/oauth/authorize">${fields}<label for="pairing_code">Codice temporaneo DAYLY</label><input id="pairing_code" name="pairing_code" required autocomplete="one-time-code" style="display:block;width:100%;box-sizing:border-box;padding:13px;margin:8px 0 18px;border:1px solid #c9e0e6;border-radius:9px"><button style="border:0;border-radius:9px;background:#126b9e;color:white;font-weight:700;padding:13px 18px">Autorizza Claude</button></form><p style="font-size:12px;color:#6f8490">Non inserire qui password o chiavi API. Il codice collega soltanto il tuo archivio DAYLY.</p></main></body></html>`)
  }

  if (path === '/authorize' && request.method === 'POST') {
    const form = readBody(request)
    const redirect = safeRedirect(form.redirect_uri)
    const pair = verifyToken(form.pairing_code, 'pair')
    if (!redirect || !pair || !form.code_challenge || form.code_challenge_method !== 'S256') return response.status(400).send('Codice scaduto o richiesta non valida. Genera un nuovo codice in DAYLY.')
    const code = signToken({ type: 'code', sub: pair.sub, accountKey: pair.accountKey, tokenVersion: pair.tokenVersion, clientId: form.client_id, resource: 'https://dayly-delta.vercel.app/api/mcp', redirectUri: redirect.href, challenge: form.code_challenge, scopes: String(form.scope || 'dayly:read dayly:write').split(' ').filter(s => ['dayly:read','dayly:write'].includes(s)), exp: Math.floor(Date.now() / 1000) + 180, jti: randomUUID() })
    const destination = new URL(redirect.href)
    destination.searchParams.set('code', code)
    if (form.state) destination.searchParams.set('state', form.state)
    response.statusCode = 302
    response.setHeader('Location', destination.toString())
    return response.end()
  }

  if (path === '/token' && request.method === 'POST') {
    const form = readBody(request)
    if (form.grant_type === 'authorization_code') {
      const code = verifyToken(form.code, 'code')
      const redirect = safeRedirect(form.redirect_uri)
      if (!code || code.clientId !== form.client_id || !redirect || code.redirectUri !== redirect.href || !verifyPkce(form.code_verifier, code.challenge)) return sendJson(response, 400, { error: 'invalid_grant' })
      const metadata = await readPrivateJson(`users/${accountHash(code.sub)}/meta.json`)
      if (!metadata || metadata.tokenVersion !== code.tokenVersion || metadata.credentialHash !== credentialHash(code.accountKey)) return sendJson(response, 400, { error: 'invalid_grant' })
      const now = Math.floor(Date.now() / 1000)
      const accessToken = signToken({ type: 'access', sub: code.sub, accountKey: code.accountKey, tokenVersion: code.tokenVersion, clientId: code.clientId, aud: code.resource, scope: code.scopes.join(' '), exp: now + 3600, jti: randomUUID() })
      const refreshToken = signToken({ type: 'refresh', sub: code.sub, accountKey: code.accountKey, tokenVersion: code.tokenVersion, clientId: code.clientId, aud: code.resource, scope: code.scopes.join(' '), exp: now + 30 * 86400, jti: randomUUID() })
      return sendJson(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: code.scopes.join(' ') })
    }
    if (form.grant_type === 'refresh_token') {
      const previous = verifyToken(form.refresh_token, 'refresh')
      if (!previous) return sendJson(response, 400, { error: 'invalid_grant' })
      const metadata = await readPrivateJson(`users/${accountHash(previous.sub)}/meta.json`)
      if (!metadata || metadata.tokenVersion !== previous.tokenVersion || metadata.credentialHash !== credentialHash(previous.accountKey) || previous.clientId !== form.client_id) return sendJson(response, 400, { error: 'invalid_grant' })
      const now = Math.floor(Date.now() / 1000)
      const accessToken = signToken({ ...previous, type: 'access', iat: now, exp: now + 3600, jti: randomUUID() })
      return sendJson(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: form.refresh_token, scope: previous.scope })
    }
    return sendJson(response, 400, { error: 'unsupported_grant_type' })
  }

  if (path === '/revoke' && request.method === 'POST') {
    const form = readBody(request)
    const claims = verifyToken(form.token, 'access') || verifyToken(form.token, 'refresh')
    if (claims) {
      const key = `users/${accountHash(claims.sub)}/meta.json`
      const metadata = await readPrivateJson(key)
      if (metadata && metadata.credentialHash === credentialHash(claims.accountKey)) await writePrivateJson(key, { ...metadata, tokenVersion: (metadata.tokenVersion || 0) + 1 })
    }
    return response.status(200).end()
  }

  return response.status(404).json({ error: 'Percorso OAuth non trovato.' })
}
