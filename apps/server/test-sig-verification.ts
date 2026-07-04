import { Ed25519Account } from '@aptos-labs/ts-sdk';
import { verifyWalletSignature } from './src/utils/crypto.ts';

// 1. Generate an account
const account = Ed25519Account.generate();
const walletAddress = account.accountAddress.toString();
const publicKey = account.publicKey.toString();

console.log('Wallet Address:', walletAddress);
console.log('Public Key:', publicKey);

// 2. Mock nonce & timestamp
const nonce = '1';
const issuedAt = new Date().toISOString();

// 3. Test Message 1: save-alerts
const saveAlertsMsg = JSON.stringify({
  action: 'save-alerts',
  address: walletAddress.toLowerCase(),
  issuedAt,
  nonce
});

// 4. Test Message 2: link-telegram-code
const linkTelegramCodeMsg = JSON.stringify({
  action: 'link-telegram-code',
  address: walletAddress.toLowerCase(),
  issuedAt,
  nonce
});

// We sign the message directly using the account's sign method
const sig1 = account.sign(new TextEncoder().encode(saveAlertsMsg)).toString();
const sig2 = account.sign(new TextEncoder().encode(linkTelegramCodeMsg)).toString();

const payload1 = {
  publicKey,
  signature: sig1
};

const payload2 = {
  publicKey,
  signature: sig2
};

// Verify Message 1
const result1 = verifyWalletSignature(walletAddress, saveAlertsMsg, payload1);
console.log('Result for save-alerts:', result1);

// Verify Message 2
const result2 = verifyWalletSignature(walletAddress, linkTelegramCodeMsg, payload2);
console.log('Result for link-telegram-code:', result2);
