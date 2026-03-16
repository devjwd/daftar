import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from '@aptos-labs/ts-sdk';

const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;

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

const getFullnodeUrl = () => {
  const explicit = String(process.env.MOVEMENT_RPC_URL || '').trim();
  if (explicit) return explicit;

  const network = String(process.env.VITE_NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet'
    ? 'https://testnet.movementnetwork.xyz/v1'
    : 'https://mainnet.movementnetwork.xyz/v1';
};

const getBadgeModuleAddress = () => {
  return normalizeAddress(
    process.env.BADGE_MODULE_ADDRESS ||
      process.env.VITE_BADGE_SBT_MODULE_ADDRESS ||
      process.env.VITE_BADGE_MODULE_ADDRESS ||
      ''
  );
};

const getAttestorAccount = () => {
  const privateKeyHex = normalizePrivateKey(process.env.BADGE_ATTESTOR_PRIVATE_KEY || '');
  if (!privateKeyHex) {
    return { account: null, reason: 'BADGE_ATTESTOR_PRIVATE_KEY is missing' };
  }

  try {
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const account = Account.fromPrivateKey({ privateKey });
    const expectedAddress = normalizeAddress(process.env.BADGE_ATTESTOR_ADDRESS || '');

    if (expectedAddress && String(account.accountAddress).toLowerCase() !== expectedAddress) {
      return { account: null, reason: 'BADGE_ATTESTOR_ADDRESS does not match BADGE_ATTESTOR_PRIVATE_KEY' };
    }

    return { account, reason: null };
  } catch {
    return { account: null, reason: 'Invalid BADGE_ATTESTOR_PRIVATE_KEY format' };
  }
};

const createClient = () => {
  const fullnode = getFullnodeUrl();
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode }));
};

export const getAttestationReadiness = () => {
  const moduleAddress = getBadgeModuleAddress();
  const { account, reason } = getAttestorAccount();

  if (!moduleAddress || !ADDRESS_PATTERN.test(moduleAddress)) {
    return { ready: false, reason: 'BADGE_MODULE_ADDRESS is missing or invalid' };
  }

  if (!account) {
    return { ready: false, reason: reason || 'Attestor account unavailable' };
  }

  return { ready: true, reason: null, moduleAddress, attestorAddress: String(account.accountAddress).toLowerCase() };
};

const isAlreadyAllowlisted = async (client, moduleAddress, ownerAddress, onChainBadgeId) => {
  try {
    const result = await client.view({
      payload: {
        function: `${moduleAddress}::badges::is_allowlisted`,
        typeArguments: [],
        functionArguments: [ownerAddress, Number(onChainBadgeId)],
      },
    });

    return Boolean(result && result[0]);
  } catch {
    return false;
  }
};

export const attestBadgeAllowlistOnChain = async ({ ownerAddress, onChainBadgeId }) => {
  const normalizedOwner = normalizeAddress(ownerAddress);
  if (!ADDRESS_PATTERN.test(normalizedOwner)) {
    return { ok: false, skipped: true, reason: 'Invalid owner address' };
  }

  const numericBadgeId = Number(onChainBadgeId);
  if (!Number.isFinite(numericBadgeId) || numericBadgeId < 0) {
    return { ok: false, skipped: true, reason: 'Invalid on-chain badge id' };
  }

  const moduleAddress = getBadgeModuleAddress();
  if (!moduleAddress || !ADDRESS_PATTERN.test(moduleAddress)) {
    return { ok: false, skipped: true, reason: 'BADGE_MODULE_ADDRESS is missing or invalid' };
  }

  const { account, reason } = getAttestorAccount();
  if (!account) {
    return { ok: false, skipped: true, reason: reason || 'Attestor account unavailable' };
  }

  const client = createClient();

  if (await isAlreadyAllowlisted(client, moduleAddress, normalizedOwner, numericBadgeId)) {
    return {
      ok: true,
      alreadyAllowlisted: true,
      txHash: null,
      attestor: String(account.accountAddress).toLowerCase(),
    };
  }

  try {
    const transaction = await client.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${moduleAddress}::badges::add_allowlist_entries`,
        typeArguments: [],
        functionArguments: [numericBadgeId, [normalizedOwner]],
      },
    });

    const pending = await client.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    await client.waitForTransaction({ transactionHash: pending.hash });

    return {
      ok: true,
      alreadyAllowlisted: false,
      txHash: pending.hash,
      attestor: String(account.accountAddress).toLowerCase(),
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: String(error?.message || 'On-chain attestation transaction failed').slice(0, 240),
    };
  }
};
