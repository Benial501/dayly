import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const secret = () => process.env.DAYLY_AUTH_SECRET || ''
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function accountHash(accountId) {
  return createHash('sha256').update(accountId).digest('hex')
}

export function credentialHash(credential) {
  return createHash('sha256').update(credential).digest('hex')
}

export function signToken(claims) {
  if (secret().length < 32) throw new Error('Configurazione sicurezza mancante')
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000) })
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyToken(token, expectedType) {
  if (typeof token !== 'string' || !secret()) return null
  const [payload, supplied, extra] = token.split('.')
  if (!payload || !supplied || extra) return null
  const expected = createHmac('sha256', secret()).update(payload).digest()
  let actual
  try { actual = Buffer.from(supplied, 'base64url') } catch { return null }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (claims.exp <= Math.floor(Date.now() / 1000) || claims.type !== expectedType) return null
    return claims
  } catch { return null }
}

export function bearer(request) {
  const value = request.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

export async function verifyAccount(request, accountId, metadata) {
  const credential = bearer(request)
  if (!credential || !accountId || !metadata?.credentialHash) return null
  const actual = Buffer.from(credentialHash(credential), 'hex')
  const expected = Buffer.from(metadata.credentialHash, 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  return credential
}

export function equalSecret(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}
