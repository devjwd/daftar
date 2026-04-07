import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'BADGE_ATTESTOR_PRIVATE_KEY',
  'BADGE_ATTESTOR_ADDRESS',
  'BADGE_MODULE_ADDRESS',
  'MOVEMENT_RPC_URL',
];

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.join(PROJECT_ROOT, 'frontend', '.env'), override: false });

const walletAddressArg = String(process.argv[2] || '').trim();

if (!WALLET_REGEX.test(walletAddressArg)) {
  console.error('Usage: node scripts/testBadgeSystem.js 0xYOUR_WALLET_ADDRESS');
  process.exitCode = 1;
  process.exit();
}

const walletAddress = walletAddressArg.toLowerCase();
const textEncoder = new TextEncoder();
const stepResults = [];

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const normalizePrivateKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const createSupabaseClient = (key) => {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  return createClient(supabaseUrl, String(key || '').trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const getApiBaseUrl = () => {
  const explicit = String(
    process.env.BADGE_API_BASE ||
      process.env.VITE_BADGE_API_BASE ||
      process.env.APP_URL ||
      ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (explicit) return explicit;

  const vercelUrl = String(process.env.VERCEL_URL || '').trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }

  return 'http://localhost:3000';
};

const formatMs = (value) => `${Math.round(value)}ms`;

const printCheck = (label, passed, detail = '') => {
  const status = passed ? 'PASS' : 'FAIL';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status}  ${label}${suffix}`);
};

const detectUserAwardsSource = (awards) => {
  if (!Array.isArray(awards) || awards.length === 0) return 'none';

  const looksBlob = awards.some(
    (entry) => entry?.txHash || entry?.payload?.txHash || entry?.payload?.onChainBadgeId != null
  );
  if (looksBlob) return 'Blob';

  const looksSupabase = awards.some(
    (entry) => entry?.payload && (Object.prototype.hasOwnProperty.call(entry.payload, 'proofHash') || Object.prototype.hasOwnProperty.call(entry.payload, 'eligible'))
  );
  if (looksSupabase) return 'Supabase';

  return 'unknown';
};

const deriveAttestorAccount = () => {
  const privateKeyHex = normalizePrivateKey(process.env.BADGE_ATTESTOR_PRIVATE_KEY);
  const configuredAddress = normalizeAddress(process.env.BADGE_ATTESTOR_ADDRESS);
  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const account = Account.fromPrivateKey({ privateKey });
  const derivedAddress = String(account.accountAddress).toLowerCase();
  return { account, configuredAddress, derivedAddress };
};

const createLocalAttestation = ({ targetWallet, badgeId, ttlMinutes = 24 * 60 }) => {
  const { account, derivedAddress } = deriveAttestorAccount();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(ttlMinutes || 0) * 60_000).toISOString();
  const message = `daftar.badge.eligibility:v1:${targetWallet}:${badgeId}:${issuedAt}:${expiresAt}`;
  const signature = account.sign(textEncoder.encode(message));
  const signatureHex = Buffer.from(signature.toUint8Array()).toString('hex');
  const proofHash = createHash('sha256').update(`${message}:${signatureHex}`).digest('hex');

  return {
    issuedAt,
    expiresAt,
    message,
    signatureHex,
    proofHash,
    attestorAddress: derivedAddress,
  };
};

const runStep = async (name, fn) => {
  const startedAt = performance.now();
  try {
    const result = await fn();
    const passed = result?.pass !== false;
    const durationMs = performance.now() - startedAt;
    stepResults.push({ Step: name, Status: passed ? 'PASS' : 'FAIL', Time: formatMs(durationMs) });
    return { ...(result || {}), pass: passed, durationMs };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    stepResults.push({ Step: name, Status: 'FAIL', Time: formatMs(durationMs) });
    console.error(`FAIL  ${name} - ${String(error?.message || error)}`);
    return { pass: false, error: String(error?.message || error), durationMs };
  }
};

const main = async () => {
  const apiBaseUrl = getApiBaseUrl();
  const serviceClient = String(process.env.SUPABASE_SERVICE_KEY || '').trim()
    ? createSupabaseClient(process.env.SUPABASE_SERVICE_KEY)
    : null;
  const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const anonClient = anonKey ? createSupabaseClient(anonKey) : null;

  let insertedTestBadgeId = null;
  let localTestAttestation = null;

  const cleanupTestRow = async () => {
    if (!serviceClient || !insertedTestBadgeId) return;
    await serviceClient
      .from('badge_attestations')
      .delete()
      .eq('wallet_address', walletAddress)
      .eq('badge_id', insertedTestBadgeId);
  };

  const step1 = await runStep('Step 1 - Config validation', async () => {
    console.log('\nStep 1 - Config validation');
    let pass = true;

    for (const key of REQUIRED_ENV_VARS) {
      const exists = String(process.env[key] || '').trim().length > 0;
      printCheck(`${key} exists`, exists);
      if (!exists) pass = false;
    }

    try {
      const { configuredAddress, derivedAddress } = deriveAttestorAccount();
      const matches = configuredAddress === derivedAddress;
      printCheck('Attestor private key matches BADGE_ATTESTOR_ADDRESS', matches, `derived=${derivedAddress}`);
      if (!matches) pass = false;
    } catch (error) {
      printCheck('Attestor private key matches BADGE_ATTESTOR_ADDRESS', false, String(error?.message || error));
      pass = false;
    }

    if (!serviceClient) {
      printCheck('Supabase service connection works', false, 'Missing service client');
      pass = false;
    } else {
      const { error } = await serviceClient.from('badge_definitions').select('badge_id').limit(1);
      printCheck('Supabase service connection works', !error, error?.message || 'SELECT badge_definitions succeeded');
      if (error) pass = false;
    }

    return { pass };
  });

  const step2 = await runStep('Step 2 - Supabase RLS check', async () => {
    console.log('\nStep 2 - Supabase RLS check');
    let pass = true;

    if (!anonClient) {
      printCheck('Anon key available for RLS test', false, 'Missing VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY');
      return { pass: false };
    }

    const attestationsResult = await anonClient.from('badge_attestations').select('badge_id').limit(1);
    printCheck(
      'Anon SELECT on badge_attestations',
      !attestationsResult.error,
      attestationsResult.error?.message || `${Array.isArray(attestationsResult.data) ? attestationsResult.data.length : 0} rows`
    );
    if (attestationsResult.error) pass = false;

    const definitionsResult = await anonClient.from('badge_definitions').select('badge_id, name').limit(5).order('badge_id');
    printCheck(
      'Anon SELECT on badge_definitions',
      !definitionsResult.error,
      definitionsResult.error?.message || `${Array.isArray(definitionsResult.data) ? definitionsResult.data.length : 0} rows`
    );
    if (definitionsResult.error) pass = false;

    return { pass };
  });

  const step3 = await runStep('Step 3 - Eligibility check', async () => {
    console.log('\nStep 3 - Eligibility check');
    const url = new URL('/api/badges/eligibility', apiBaseUrl);
    url.searchParams.set('address', walletAddress);
    url.searchParams.set('wallet', walletAddress);
    url.searchParams.set('badgeId', '1');

    const response = await fetch(url);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      printCheck('Eligibility endpoint call', false, `${response.status} ${payload?.error || 'Unknown error'}`);
      return { pass: false, payload };
    }

    const status = payload?.status || 'unknown';
    let dataSource = 'unknown';
    if (payload?.cached === true) {
      dataSource = 'Supabase cache';
    } else if (payload?.cached === false) {
      dataSource = 'fresh evaluation';
    } else if (status === 'already_owned') {
      dataSource = 'on-chain ownership';
    }

    printCheck('Eligibility status returned', true, status);
    console.log(`INFO  Eligibility data source: ${dataSource}`);

    return { pass: true, payload, dataSource };
  });

  const step4 = await runStep('Step 4 - Award flow simulation', async () => {
    console.log('\nStep 4 - Award flow simulation');
    if (!serviceClient) {
      printCheck('Service client available for direct upsert', false, 'Missing SUPABASE_SERVICE_KEY');
      return { pass: false };
    }

    insertedTestBadgeId = `test-badge-system-${Date.now()}`;
    localTestAttestation = createLocalAttestation({ targetWallet: walletAddress, badgeId: insertedTestBadgeId, ttlMinutes: 30 });

    const { error: upsertError } = await serviceClient.from('badge_attestations').upsert(
      {
        wallet_address: walletAddress,
        badge_id: insertedTestBadgeId,
        eligible: true,
        verified_at: localTestAttestation.issuedAt,
        expires_at: localTestAttestation.expiresAt,
        proof_hash: localTestAttestation.proofHash,
      },
      { onConflict: 'wallet_address,badge_id' }
    );

    if (upsertError) {
      printCheck('Direct test attestation upsert', false, upsertError.message || 'Unknown upsert error');
      return { pass: false };
    }

    printCheck('Direct test attestation upsert', true, insertedTestBadgeId);

    const url = new URL(`/api/badges/user/${encodeURIComponent(walletAddress)}`, apiBaseUrl);
    const response = await fetch(url);
    const payload = await response.json().catch(() => null);
    const awards = Array.isArray(payload) ? payload : Array.isArray(payload?.awards) ? payload.awards : [];
    const found = awards.some((award) => String(award?.badgeId || award?.badge_id || '') === insertedTestBadgeId);
    const source = detectUserAwardsSource(awards);

    if (found) {
      printCheck('User awards endpoint includes test badge', true, `source=${source}`);
      return { pass: true, source, awards };
    }

    printCheck('User awards endpoint includes test badge', false, `source=${source}`);
    return { pass: false, source, awards };
  });

  const step5 = await runStep('Step 5 - Proof hash verification', async () => {
    console.log('\nStep 5 - Proof hash verification');
    if (!serviceClient || !insertedTestBadgeId || !localTestAttestation) {
      printCheck('Attestation row available for proof hash verification', false, 'Step 4 did not create a test row');
      return { pass: false };
    }

    const { data, error } = await serviceClient
      .from('badge_attestations')
      .select('wallet_address, badge_id, proof_hash')
      .eq('wallet_address', walletAddress)
      .eq('badge_id', insertedTestBadgeId)
      .maybeSingle();

    if (error || !data) {
      printCheck('Read attestation row back from Supabase', false, error?.message || 'Row not found');
      return { pass: false };
    }

    const expectedHash = createHash('sha256')
      .update(`${localTestAttestation.message}:${localTestAttestation.signatureHex}`)
      .digest('hex');
    const storedHash = String(data.proof_hash || '');
    const matches = storedHash === expectedHash;

    printCheck('Stored proof_hash matches recomputed hash', matches, matches ? storedHash : `stored=${storedHash} expected=${expectedHash}`);
    return { pass: matches };
  });

  await cleanupTestRow();

  console.log('\nStep 6 - Final summary');
  console.table(stepResults);

  const overallPass = [step1, step2, step3, step4, step5].every((result) => result?.pass === true);
  console.log(overallPass ? 'OVERALL: PASS' : 'OVERALL: FAIL');
  if (!overallPass) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  console.error('Fatal test script error:', error);
  process.exitCode = 1;
});