import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Only allow production origin.
app.use(
  cors({
    origin: ['https://daftar-jet-eight.vercel.app'],
    credentials: true,
  })
);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, PORT = '3001' } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[a-f0-9]+$/i.test(stripped)) return '';
  const compact = stripped.replace(/^0+/, '') || '0';
  return `0x${compact}`;
};

const parseSignaturePayload = (signature) => {
  if (signature && typeof signature === 'object') return signature;
  if (typeof signature !== 'string') return null;
  try {
    return JSON.parse(signature);
  } catch {
    return null;
  }
};

export const verifyWalletSignature = (walletAddress, message, signature) => {
  const parsed = parseSignaturePayload(signature);
  const publicKeyHex = String(parsed?.publicKey || parsed?.public_key || '').trim();
  const signatureHex = String(parsed?.signature || parsed?.sig || '').trim();

  if (!publicKeyHex || !signatureHex || !message) {
    return false;
  }

  try {
    const publicKey = new Ed25519PublicKey(publicKeyHex);
    const aptosSignature = new Ed25519Signature(signatureHex);
    const verified = publicKey.verifySignature({
      message: new TextEncoder().encode(String(message)),
      signature: aptosSignature,
    });

    if (!verified) return false;

    const derivedAddress = normalizeAddress(String(publicKey.authKey().derivedAddress()));
    return derivedAddress === normalizeAddress(walletAddress);
  } catch {
    return false;
  }
};

const oneMinuteMs = 60 * 1000;

const badgeLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const awardLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/api/badges', badgeLimiter);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/badges/user/:walletAddress', async (req, res) => {
  const walletAddress = normalizeAddress(req.params.walletAddress);
  if (!walletAddress) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const { data, error } = await supabaseAdmin
    .from('badge_attestations')
    .select('wallet_address, badge_id, eligible, verified_at, proof_hash')
    .eq('wallet_address', walletAddress)
    .eq('eligible', true)
    .order('verified_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch badges' });
  }

  return res.status(200).json({ awards: Array.isArray(data) ? data : [] });
});

app.post('/api/badges/track', async (req, res) => {
  const walletAddress = normalizeAddress(req.body?.walletAddress);
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  const { error } = await supabaseAdmin
    .from('badge_tracked_addresses')
    .upsert(
      {
        wallet_address: walletAddress,
        added_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    );

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to track address' });
  }

  return res.status(200).json({ ok: true, walletAddress });
});

app.post('/api/badges/award', awardLimiter, async (req, res) => {
  const walletAddress = normalizeAddress(req.body?.walletAddress);
  const signedMessage = String(req.body?.signedMessage || '').trim();
  const signature = req.body?.signature;
  const badgeId = String(req.body?.badgeId || '').trim();

  if (!walletAddress || !signedMessage || !signature || !badgeId) {
    return res.status(400).json({ error: 'walletAddress, badgeId, signedMessage, and signature are required' });
  }

  const isValid = verifyWalletSignature(walletAddress, signedMessage, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid wallet signature' });
  }

  const proofHash = createHash('sha256').update(signedMessage).digest('hex');
  const verifiedAt = new Date().toISOString();

  const [attestationResult, trackedResult] = await Promise.all([
    supabaseAdmin.from('badge_attestations').upsert(
      {
        wallet_address: walletAddress,
        badge_id: badgeId,
        eligible: true,
        verified_at: verifiedAt,
        proof_hash: proofHash,
      },
      { onConflict: 'wallet_address,badge_id' }
    ),
    supabaseAdmin.from('badge_tracked_addresses').upsert(
      {
        wallet_address: walletAddress,
        added_at: verifiedAt,
      },
      { onConflict: 'wallet_address' }
    ),
  ]);

  if (attestationResult.error) {
    return res.status(500).json({ error: attestationResult.error.message || 'Failed to write attestation' });
  }

  if (trackedResult.error) {
    return res.status(500).json({ error: trackedResult.error.message || 'Failed to track address' });
  }

  return res.status(200).json({ ok: true, walletAddress, badgeId });
});

app.listen(Number(PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`Badge API listening on ${PORT}`);
});