import { hasBadge } from '../badgeService.js';

export const extractTransactionHash = (txResponse) => {
  if (!txResponse || typeof txResponse !== 'object') return null;
  return txResponse.hash || txResponse.transactionHash || txResponse.txnHash || null;
};

export const waitForSuccessfulTransaction = async ({ client, txHash }) => {
  if (!client || typeof client.waitForTransaction !== 'function') {
    throw new Error('Aptos client is required to verify mint transaction status');
  }
  if (!txHash) {
    throw new Error('Mint transaction submitted but hash was not returned by wallet');
  }

  const txResult = await client.waitForTransaction({ transactionHash: txHash });
  const success = txResult?.success === true;

  if (!success) {
    const vmStatus = txResult?.vm_status || txResult?.vmStatus || 'unknown VM status';
    throw new Error(`Mint transaction failed: ${vmStatus}`);
  }

  return txResult;
};

export const verifyOnChainBadgeOwnership = async ({ client, badgeId, owner }) => {
  const confirmedOwned = await hasBadge(client, Number(badgeId), owner);
  if (!confirmedOwned) {
    throw new Error('Mint transaction succeeded but on-chain badge ownership was not confirmed');
  }
  return true;
};

export const confirmMintAndOwnership = async ({ client, txResponse, badgeId, owner }) => {
  const txHash = extractTransactionHash(txResponse);
  await waitForSuccessfulTransaction({ client, txHash });
  await verifyOnChainBadgeOwnership({ client, badgeId, owner });
  return txHash;
};
