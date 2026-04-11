// @ts-ignore Remote Deno module
import nacl from 'https://esm.sh/tweetnacl@1.0.3'
// @ts-ignore Remote Deno module
import { sha3_256 } from 'https://esm.sh/@noble/hashes@1.5.0/sha3'

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    'authorization',
    'x-client-info',
    'apikey',
    'content-type',
    'x-admin-address',
    'x-admin-public-key',
    'x-admin-signature',
    'x-admin-message-b64',
    'x-admin-full-message-b64',
  ].join(', '),
}

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000

export const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const normalizeHex = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  return raw.startsWith('0x') ? raw : `0x${raw}`
}

export const normalizeAddress = (value: unknown) => {
  const normalized = normalizeHex(value)
  if (!normalized) return ''
  const withoutPrefix = normalized.slice(2)
  if (!/^[0-9a-f]+$/i.test(withoutPrefix)) return ''
  return `0x${withoutPrefix.padStart(64, '0')}`
}

const hexToBytes = (value: string) => {
  const normalized = normalizeHex(value).slice(2)
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('Invalid hex value')
  }

  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }
  return bytes
}

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const deriveAptosAddress = (publicKeyHex: string) => {
  const publicKeyBytes = hexToBytes(publicKeyHex)
  const authenticationKey = sha3_256(new Uint8Array([...publicKeyBytes, 0x00])) as Uint8Array
  return normalizeAddress(`0x${Array.from(authenticationKey, (byte: number) => byte.toString(16).padStart(2, '0')).join('')}`)
}

export const verifyAdminRequest = async (
  req: Request,
  payload: Record<string, unknown>,
  expectedAction: string,
) => {
  const allowedAddress = normalizeAddress(Deno.env.get('ADMIN_WALLET_ADDRESS'))
  if (!allowedAddress) {
    throw new Error('ADMIN_WALLET_ADDRESS secret is not configured')
  }

  const claimedAddress = normalizeAddress(req.headers.get('x-admin-address'))
  const publicKey = normalizeHex(req.headers.get('x-admin-public-key'))
  const signature = normalizeHex(req.headers.get('x-admin-signature'))
  const messageB64 = String(req.headers.get('x-admin-message-b64') || '')
  const fullMessageB64 = String(req.headers.get('x-admin-full-message-b64') || '')

  if (!claimedAddress || !publicKey || !signature || !messageB64 || !fullMessageB64) {
    return { ok: false, response: jsonResponse({ error: 'Missing admin proof headers' }, 401) }
  }

  let message = ''
  let fullMessage = ''
  let proof: Record<string, unknown> = {}

  try {
    message = decodeBase64(messageB64)
    fullMessage = decodeBase64(fullMessageB64)
    proof = JSON.parse(message)
  } catch {
    return { ok: false, response: jsonResponse({ error: 'Invalid admin proof payload' }, 401) }
  }

  const issuedAt = Date.parse(String(proof.issuedAt ?? ''))
  const nonce = String(proof.nonce ?? '')
  const action = String(proof.action ?? '')
  const bodyHash = String(proof.bodyHash ?? '')

  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > ADMIN_SIGNATURE_TTL_MS) {
    return { ok: false, response: jsonResponse({ error: 'Admin proof has expired' }, 401) }
  }

  if (!nonce || action !== expectedAction) {
    return { ok: false, response: jsonResponse({ error: 'Admin proof action mismatch' }, 401) }
  }

  const expectedHash = await sha256Hex(stableStringify(payload))
  if (bodyHash !== expectedHash) {
    return { ok: false, response: jsonResponse({ error: 'Admin proof body hash mismatch' }, 401) }
  }

  if (!fullMessage.includes(`message: ${message}`) || !fullMessage.includes(`nonce: ${nonce}`)) {
    return { ok: false, response: jsonResponse({ error: 'Signed message content mismatch' }, 401) }
  }

  let verified = false
  let derivedAddress = ''
  try {
    verified = nacl.sign.detached.verify(
      new TextEncoder().encode(fullMessage),
      hexToBytes(signature),
      hexToBytes(publicKey),
    )
    derivedAddress = deriveAptosAddress(publicKey)
  } catch {
    return { ok: false, response: jsonResponse({ error: 'Invalid admin signature' }, 401) }
  }

  if (!verified || claimedAddress !== derivedAddress || derivedAddress !== allowedAddress) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized admin signer' }, 401) }
  }

  return { ok: true, adminAddress: derivedAddress }
}
