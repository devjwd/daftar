import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load environment
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.join(PROJECT_ROOT, 'frontend', '.env'), override: false });

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m"
};

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

async function verifyWiring() {
  console.log(`${colors.bright}=== Daftar Wiring Verification (Mainnet) ===${colors.reset}\n`);

  const privateKeyHex = process.env.BADGE_SIGNER_PRIVATE_KEY || process.env.BADGE_ATTESTOR_PRIVATE_KEY;
  const moduleAddress = normalizeAddress(process.env.BADGE_MODULE_ADDRESS || process.env.VITE_BADGE_MODULE_ADDRESS);
  const rpcUrl = process.env.MOVEMENT_RPC_URL || 'https://mainnet.movementnetwork.xyz/v1';

  if (!privateKeyHex) {
    console.error(`${colors.red}FAIL: Missing BADGE_SIGNER_PRIVATE_KEY in .env${colors.reset}`);
    return;
  }

  if (!moduleAddress || moduleAddress === '0x') {
    console.error(`${colors.red}FAIL: Missing BADGE_MODULE_ADDRESS in .env${colors.reset}`);
    return;
  }

  console.log(`Checking Module: ${colors.cyan}${moduleAddress}${colors.reset}`);
  console.log(`RPC URL:        ${colors.cyan}${rpcUrl}${colors.reset}\n`);

  // 1. Derive Public Key from Local Private Key
  let derivedPubKeyHex = '';
  try {
    const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
    const privateKey = new Ed25519PrivateKey(cleanKey);
    derivedPubKeyHex = privateKey.publicKey().toString();
  } catch (err) {
    console.error(`${colors.red}FAIL: Invalid Private Key format. ${err.message}${colors.reset}`);
    return;
  }

  // 2. Fetch Registry from Chain
  const resourceType = `${moduleAddress}::badges::BadgeRegistry`;
  const url = `${rpcUrl}/accounts/${moduleAddress}/resource/${resourceType}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      console.error(`${colors.red}FAIL: Could not fetch Registry from chain.${colors.reset}`);
      console.error(`Status: ${resp.status}`);
      console.error(`Details: ${JSON.stringify(errData)}`);
      console.log(`\n${colors.yellow}TIP: Make sure your contract is deployed and initialized on Mainnet!${colors.reset}`);
      return;
    }

    const resource = await resp.json();
    const onChainPubKeyRaw = resource?.data?.signer_pub_key;
    
    let onChainPubKeyHex = '';
    if (Array.isArray(onChainPubKeyRaw)) {
        onChainPubKeyHex = onChainPubKeyRaw.map(b => Number(b).toString(16).padStart(2, '0')).join('');
    } else if (typeof onChainPubKeyRaw === 'string') {
        onChainPubKeyHex = onChainPubKeyRaw;
    }

    const cleanLocal = derivedPubKeyHex.startsWith('0x') ? derivedPubKeyHex.slice(2) : derivedPubKeyHex;
    const cleanOnChain = onChainPubKeyHex.startsWith('0x') ? onChainPubKeyHex.slice(2) : onChainPubKeyHex;
    
    console.log(`Local Signer Public Key:  ${colors.yellow}${cleanLocal}${colors.reset}`);
    console.log(`On-Chain Public Key:    ${colors.yellow}${cleanOnChain}${colors.reset}\n`);

    // 3. Comparison
    if (cleanLocal === cleanOnChain) {
      console.log(`${colors.bright}${colors.green}✅ SUCCESS: Your Supabase Signer matches the On-Chain Registry!${colors.reset}`);
      console.log(`Your backend is now ready to issue valid on-chain badges.`);
    } else {
      console.log(`${colors.bright}${colors.red}❌ MISMATCH: Your Supabase Signer does NOT match the On-Chain Registry.${colors.reset}`);
      console.log(`Mints will fail. You must update the registry on-chain or fix the secret in Supabase.`);
    }

  } catch (err) {
    console.error(`${colors.red}FAIL: Verification error.${colors.reset}`);
    console.error(err.message);
  }
}

verifyWiring();
