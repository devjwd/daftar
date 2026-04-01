import { createClient } from '@supabase/supabase-js';
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from '@aptos-labs/ts-sdk';
import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const parseBadgeId = (value) => {
  const badgeId = Number(value);
  if (!Number.isInteger(badgeId) || badgeId < 0) return null;
  return badgeId;
};

const getFullnodeUrl = () => {
  const explicit = String(process.env.MOVEMENT_RPC_URL || '').trim();
  if (explicit) return explicit;

  const network = String(process.env.VITE_NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet'
    ? 'https://testnet.movementnetwork.xyz/v1'
    : 'https://mainnet.movementnetwork.xyz/v1';
};

const getBadgeModuleAddress = () => {
  const raw = String(
    process.env.BADGE_MODULE_ADDRESS ||
      process.env.VITE_BADGE_SBT_MODULE_ADDRESS ||
      process.env.VITE_BADGE_MODULE_ADDRESS ||
      ''
  )
    .trim()
    .toLowerCase();

  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getAdminKeyFromRequest = (req) => {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  if (auth) return auth;

  return String(req.headers['x-admin-key'] || '').trim();
};

const verifyAdminAuth = (req) => {
  const expected = String(process.env.BADGE_ADMIN_API_KEY || '').trim();
  if (!expected) {
    return { ok: false, status: 500, error: 'BADGE_ADMIN_API_KEY is not configured' };
  }

  const provided = getAdminKeyFromRequest(req);
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
};

const getAttestorAccount = () => {
  const privateKeyHexRaw = String(process.env.BADGE_ATTESTOR_PRIVATE_KEY || '').trim();
  if (!privateKeyHexRaw) {
    return { ok: false, error: 'BADGE_ATTESTOR_PRIVATE_KEY is missing' };
  }

  const privateKeyHex = privateKeyHexRaw.startsWith('0x') ? privateKeyHexRaw : `0x${privateKeyHexRaw}`;

  try {
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const account = Account.fromPrivateKey({ privateKey });

    const expectedAddress = normalizeAddress(process.env.BADGE_ATTESTOR_ADDRESS || '');
    const actualAddress = String(account.accountAddress).toLowerCase();

    if (expectedAddress && expectedAddress !== actualAddress) {
      return {
        ok: false,
        error: 'BADGE_ATTESTOR_ADDRESS does not match BADGE_ATTESTOR_PRIVATE_KEY',
      };
    }

    return { ok: true, account, attestorAddress: actualAddress };
  } catch {
    return { ok: false, error: 'Invalid BADGE_ATTESTOR_PRIVATE_KEY format' };
  }
};

const createAptosClient = () => {
  const fullnode = getFullnodeUrl();
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode }));
};

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { ok: true, supabase };
};

const validatePayload = (body) => {
  const badgeId = parseBadgeId(body?.badgeId);
  const action = String(body?.action || '').trim().toLowerCase();
  const rawAddresses = Array.isArray(body?.addresses) ? body.addresses : null;

  if (badgeId == null) {
    return { ok: false, status: 400, error: 'badgeId must be a non-negative integer' };
  }

  if (action !== 'add' && action !== 'remove') {
    return { ok: false, status: 400, error: "action must be 'add' or 'remove'" };
  }

  if (!rawAddresses || rawAddresses.length === 0) {
    return { ok: false, status: 400, error: 'addresses must be a non-empty array' };
  }

  if (rawAddresses.length > 100) {
    return { ok: false, status: 400, error: 'Maximum 100 addresses per request' };
  }

  const addresses = rawAddresses.map(normalizeAddress);
  const invalid = addresses.filter((address) => !ADDRESS_RE.test(address));
  if (invalid.length > 0) {
    return { ok: false, status: 400, error: `Invalid address format: ${invalid[0]}` };
  }

  const deduped = Array.from(new Set(addresses));

  return {
    ok: true,
    badgeId,
    action,
    addresses: deduped,
  };
};

const executeAllowlistTx = async ({ client, account, moduleAddress, badgeId, action, address }) => {
  const functionName =
    action === 'add'
      ? `${moduleAddress}::badges::add_allowlist_entries`
      : `${moduleAddress}::badges::remove_allowlist_entries`;

  try {
    const transaction = await client.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: functionName,
        typeArguments: [],
        functionArguments: [badgeId, [address]],
      },
    });

    const pending = await client.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    await client.waitForTransaction({ transactionHash: pending.hash });

    return { ok: true, txHash: pending.hash };
  } catch (error) {
    return {
      ok: false,
      txHash: null,
      error: String(error?.message || 'On-chain allowlist transaction failed').slice(0, 240),
    };
  }
};

const logActionToSupabase = async ({ supabase, badgeId, action, address, txHash }) => {
  const eligible = action === 'add';
  const proofHash = txHash ? `manual:${action}:${txHash}` : `manual:${action}:failed`;

  const result = await supabase.from('badge_attestations').upsert(
    {
      wallet_address: address,
      badge_id: badgeId,
      eligible,
      verified_at: new Date().toISOString(),
      expires_at: null,
      proof_hash: proofHash,
    },
    { onConflict: 'wallet_address,badge_id' }
  );

  if (result.error) {
    return { ok: false, error: result.error.message || 'Failed to write attestation log' };
  }

  return { ok: true };
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const auth = verifyAdminAuth(req);
    if (!auth.ok) {
      return sendJson(res, auth.status, { error: auth.error });
    }

    const parsed = validatePayload(req.body || {});
    if (!parsed.ok) {
      return sendJson(res, parsed.status, { error: parsed.error });
    }

    const moduleAddress = getBadgeModuleAddress();
    if (!ADDRESS_RE.test(moduleAddress)) {
      return sendJson(res, 500, { error: 'BADGE_MODULE_ADDRESS is missing or invalid' });
    }

    const attestor = getAttestorAccount();
    if (!attestor.ok) {
      return sendJson(res, 500, { error: attestor.error });
    }

    const supabaseResult = createSupabaseAdmin();
    if (!supabaseResult.ok) {
      return sendJson(res, 500, { error: supabaseResult.error });
    }

    const client = createAptosClient();
    const failed = [];
    let added = 0;

    for (const address of parsed.addresses) {
      const tx = await executeAllowlistTx({
        client,
        account: attestor.account,
        moduleAddress,
        badgeId: parsed.badgeId,
        action: parsed.action,
        address,
      });

      if (!tx.ok) {
        failed.push(address);
        continue;
      }

      const logResult = await logActionToSupabase({
        supabase: supabaseResult.supabase,
        badgeId: parsed.badgeId,
        action: parsed.action,
        address,
        txHash: tx.txHash,
      });

      if (!logResult.ok) {
        failed.push(address);
        continue;
      }

      added += 1;
    }

    return sendJson(res, 200, {
      success: true,
      action: parsed.action,
      added,
      failed,
    });
  } catch (error) {
    console.error('[badges/allowlist] request failed', error);
    return sendJson(res, 500, {
      error: String(error?.message || 'Internal server error').slice(0, 240),
    });
  }
}
