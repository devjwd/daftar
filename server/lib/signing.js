import { Ed25519PrivateKey, AccountAddress, Serializer } from '@aptos-labs/ts-sdk';

/**
 * Generates a signed mint authorization payload for the badges Move contract.
 * Message structure: domain || module_addr || user_addr || badge_id || valid_until || signer_epoch
 */
export async function signMintAuthorization(
  privateKeyHex,
  moduleAddress,
  userAddress,
  badgeId,
  validUntil,
  signerEpoch = 0,
) {
  let cleanKey = String(privateKeyHex || '').trim();
  if (!cleanKey) {
    throw new Error('BADGE_ATTESTOR_PRIVATE_KEY is empty or not configured');
  }
  if (cleanKey.endsWith('...') || cleanKey.includes('...')) {
    throw new Error('BADGE_ATTESTOR_PRIVATE_KEY appears to be truncated (contains "..."). Please set the full 32-byte hex key.');
  }
  if (!cleanKey.startsWith('0x')) cleanKey = '0x' + cleanKey;
  // Validate key is exactly 32 bytes (64 hex chars + "0x" prefix = 66 chars)
  const hexPart = cleanKey.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error('BADGE_ATTESTOR_PRIVATE_KEY contains invalid hex characters');
  }
  if (hexPart.length !== 64) {
    throw new Error(`BADGE_ATTESTOR_PRIVATE_KEY must be exactly 32 bytes (64 hex chars), got ${hexPart.length} chars`);
  }

  let privateKey;
  try {
    privateKey = new Ed25519PrivateKey(cleanKey);
  } catch (err) {
    throw new Error('Failed to parse private key: ' + err.message);
  }

  const domain = new TextEncoder().encode("movement.badges.mint.v1");
  
  const moduleAddr = AccountAddress.from(moduleAddress);
  const userAddr = AccountAddress.from(userAddress);
  
  // Addresses in BCS are just the 32 bytes
  const moduleBytes = moduleAddr.toUint8Array();
  const userBytes = userAddr.toUint8Array();
  
  // u64 in BCS is 8 bytes little-endian
  const sBadge = new Serializer();
  sBadge.serializeU64(BigInt(badgeId));
  const badgeIdBytes = sBadge.toUint8Array();
  
  const sValid = new Serializer();
  sValid.serializeU64(BigInt(validUntil));
  const validUntilBytes = sValid.toUint8Array();
  
  const sEpoch = new Serializer();
  sEpoch.serializeU64(BigInt(signerEpoch));
  const signerEpochBytes = sEpoch.toUint8Array();
  
  // Assemble the message payload matching the Move contract's expected format
  const finalPayload = new Uint8Array(
    domain.length + 32 + 32 + 8 + 8 + 8
  );
  let pos = 0;
  finalPayload.set(domain, pos); pos += domain.length;
  finalPayload.set(moduleBytes, pos); pos += 32;
  finalPayload.set(userBytes, pos); pos += 32;
  finalPayload.set(badgeIdBytes, pos); pos += 8;
  finalPayload.set(validUntilBytes, pos); pos += 8;
  finalPayload.set(signerEpochBytes, pos); pos += 8;
  
  const signature = privateKey.sign(finalPayload);
  
  return {
    signatureBytes: Array.from(signature.toUint8Array()),
    validUntil: Number(validUntil),
    signerEpoch: Number(signerEpoch),
  };
}
