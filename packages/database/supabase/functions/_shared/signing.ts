import { Ed25519PrivateKey, AccountAddress, Serializer } from 'https://esm.sh/@aptos-labs/ts-sdk@1.3.0'

/**
 * Generates a signed mint authorization payload for the badges Move contract.
 * Message structure: domain || module_addr || user_addr || badge_id || valid_until || signer_epoch
 */
export async function signMintAuthorization(
  privateKeyHex: string,
  moduleAddress: string,
  userAddress: string,
  badgeId: number | bigint,
  validUntil: number | bigint,
  signerEpoch: number | bigint = 0,
) {
  const privateKey = new Ed25519PrivateKey(privateKeyHex)
  
  const domain = new TextEncoder().encode("movement.badges.mint.v1")
  
  const moduleAddr = AccountAddress.from(moduleAddress)
  const userAddr = AccountAddress.from(userAddress)
  
  const serializer = new Serializer()
  // Manual concatenation to match Move's vector::append + bcs::to_bytes logic
  // Addresses in BCS are just the 32 bytes
  const moduleBytes = moduleAddr.toUint8Array()
  const userBytes = userAddr.toUint8Array()
  
  // u64 in BCS is 8 bytes little-endian
  const sBadge = new Serializer()
  sBadge.serializeU64(BigInt(badgeId))
  const badgeIdBytes = sBadge.toUint8Array()
  
  const sValid = new Serializer()
  sValid.serializeU64(BigInt(validUntil))
  const validUntilBytes = sValid.toUint8Array()
  
  const sEpoch = new Serializer()
  sEpoch.serializeU64(BigInt(signerEpoch))
  const signerEpochBytes = sEpoch.toUint8Array()
  
  // Combine all parts
  const payload = new Uint8Array(
    domain.length + 
    moduleBytes.length + 
    userBytes.length + 
    badgeIdBytes.length + 
    validUntilBytes.length + 
    signerEpochBytes.length
  )
  
  let offset = 0
  payload.set(domain, offset); offset += domain.length
  payload.set(moduleBytes, offset); offset += moduleBytes.length
  payload.set(userBytes, offset); offset += userBytes.length
  payload.set(badgeIdBytes, offset); offset += badgeIdBytes.length
  payload.set(validUntilBytes, offset); offset += validUntilBytes.length
  payload.set(signerEpochBytes, offset); offset += signerEpochBytes.length
  
  const signature = privateKey.sign(payload)
  
  return {
    signatureBytes: Array.from(signature.toUint8Array()),
    validUntil: Number(validUntil),
    signerEpoch: Number(signerEpoch),
  }
}
