/**
 * mintSigner.js
 *
 * Produces the Ed25519 signature the Move `badges::mint` entry function
 * expects as its `signature_bytes: vector<u8>` argument.
 *
 * The signed message must include domain separation and module binding,
 * then BCS-serialized user address, badge_id, and valid_until — mirroring
 * the contract:
 *
 *   let message = b"movement.badges.mint.v1";
 *   vector::append(&mut message, bcs::to_bytes(&@swap_router));
 *   vector::append(&mut message, bcs::to_bytes(&user_addr));
 *   vector::append(&mut message, bcs::to_bytes(&badge_id));
 *   vector::append(&mut message, bcs::to_bytes(&valid_until));
 *   vector::append(&mut message, bcs::to_bytes(&signer_epoch));
 *
 * BCS encoding (must match Move exactly):
 *   - address → 32 raw bytes (AccountAddress, no length prefix)
 *   - u64     → 8 bytes, little-endian
 *
 * Total message size: domain + 32 module + 32 user + 8 badge_id + 8 valid_until + 8 signer_epoch
 */

import { Serializer, AccountAddress } from '@aptos-labs/ts-sdk';
import { getValidatedAttestorAccount } from '../badges/attestorConfig.js';

/**
 * Build the raw BCS message that the contract verifies.
 *
 * @param {string} userAddress   - Hex wallet address (e.g. "0x1a2b…")
 * @param {number} badgeId       - On-chain badge ID (positive integer)
 * @param {number} validUntil    - Unix timestamp (seconds) after which the signature expires
 * @param {string} moduleAddress - Badge module address bound to the signature domain
 * @param {number} signerEpoch   - Current on-chain signer epoch used for immediate key-rotation revocation
 * @returns {Uint8Array}         - Raw message bytes expected by on-chain verification
 */
export const buildMintMessage = (userAddress, badgeId, validUntil, moduleAddress, signerEpoch) => {
  const domain = new TextEncoder().encode('movement.badges.mint.v1');

  const serializer = new Serializer();
  AccountAddress.fromString(moduleAddress).serialize(serializer);
  AccountAddress.fromString(userAddress).serialize(serializer);
  serializer.serializeU64(BigInt(badgeId));
  serializer.serializeU64(BigInt(validUntil));
  serializer.serializeU64(BigInt(signerEpoch));

  const payload = serializer.toUint8Array();
  const message = new Uint8Array(domain.length + payload.length);
  message.set(domain, 0);
  message.set(payload, domain.length);
  return message;
};

/**
 * Sign the mint payload with the attestor's Ed25519 private key.
 *
 * @param {string} userAddress   - Hex wallet address
 * @param {number} badgeId       - On-chain badge ID
 * @param {number} validUntil    - Unix timestamp (seconds) when the signature expires
 * @param {string} moduleAddress - Badge module address bound to this signature
 * @param {number} signerEpoch   - Current on-chain signer epoch
 * @returns {number[]}         - 64-byte signature as an array of numbers,
 *                               ready to be sent as JSON and submitted on-chain
 *                               as `vector<u8>`.
 * @throws If the attestor account is not configured.
 */
export const signMintPayload = (userAddress, badgeId, validUntil, moduleAddress, signerEpoch) => {
  const { account } = getValidatedAttestorAccount();
  const message = buildMintMessage(userAddress, badgeId, validUntil, moduleAddress, signerEpoch);
  const signature = account.sign(message);
  return Array.from(signature.toUint8Array());
};
