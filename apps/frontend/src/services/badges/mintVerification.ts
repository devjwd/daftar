import { hasBadge } from '../badgeService';

interface TransactionResponse {
  hash?: string;
  transactionHash?: string;
  txnHash?: string;
}

interface AptosClient {
  waitForTransaction: (params: { transactionHash: string }) => Promise<any>;
}

export const extractTransactionHash = (txResponse: TransactionResponse | any): string | null => {
  if (!txResponse || typeof txResponse !== 'object') return null;
  return txResponse.hash || txResponse.transactionHash || txResponse.txnHash || null;
};

interface WaitParams {
  client: AptosClient;
  txHash: string;
}

export const waitForSuccessfulTransaction = async ({ client, txHash }: WaitParams): Promise<any> => {
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

interface VerifyParams {
  client: any;
  badgeId: string | number;
  owner: string;
}

export const verifyOnChainBadgeOwnership = async ({ client, badgeId, owner }: VerifyParams): Promise<boolean> => {
  const confirmedOwned = await hasBadge(client, Number(badgeId), owner);
  if (!confirmedOwned) {
    throw new Error('Mint transaction succeeded but on-chain badge ownership was not confirmed');
  }
  return true;
};

interface ConfirmParams {
  client: AptosClient;
  txResponse: TransactionResponse;
  badgeId: string | number;
  owner: string;
}

export const confirmMintAndOwnership = async ({ client, txResponse, badgeId, owner }: ConfirmParams): Promise<string> => {
  const txHash = extractTransactionHash(txResponse);
  if (!txHash) throw new Error('Failed to extract transaction hash');
  await waitForSuccessfulTransaction({ client, txHash });
  await verifyOnChainBadgeOwnership({ client, badgeId, owner });
  return txHash;
};
