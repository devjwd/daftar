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
  if (cleanKey.endsWith('...')) cleanKey = cleanKey.slice(0, -3);
  if (!cleanKey.startsWith('0x')) cleanKey = '0x' + cleanKey;
  if (cleanKey.length % 2 !== 0) cleanKey += '0'; // Pad to even length
  if (cleanKey.length < 66) cleanKey = cleanKey.padEnd(66, '0'); // Pad to 32 bytes

  let privateKey;
  try {
    privateKey = new Ed25519PrivateKey(cleanKey);
  } catch (err) {
    throw new Error('Failed to parse private key: ' + err.message);
  }

  const domain = new TextEncoder().encode("movement.badges.mint.v1");
  
  const moduleAddr = AccountAddress.from(moduleAddress);
  const userAddr = AccountAddress.from(userAddress);
  
  const serializer = new Serializer();
  // Manual concatenation to match Move's vector::append + bcs::to_bytes logic
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
  
  // Combine all parts
  const payload = new Uint8Array(
    domain.length + 
    moduleBytes.length + 
    userBytes.length + 
    badgeIdBytes.length + 
    validUntilBytes.length + 
    signerEpochBytes.length
  );
  
  let offset = 0;
  payload.set(domain, offset); offset += domain.length;
  payload.set(moduleBytes, offset); offset += moduleBytes.length;
  payload.set(userBytes, offset); offset += userAddr.toUint8Array().length; // Fix: ensure userBytes length is used
  // Wait, I used userAddr.toUint8Array() directly above, let's be consistent.
  
  // Refined payload assembly
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
