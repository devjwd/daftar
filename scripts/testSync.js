import fetch from 'node-fetch';
import { createHash } from 'crypto';
import nacl from 'tweetnacl';

const ADMIN_WALLET = '0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69';
const ADMIN_PRIVATE_KEY = '0x82f195373dfe3479c3111509221571c0ee6f42ee7a3b29a88245ec40c907ce89';

const hexToBytes = (hex) => {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.substr(i, 2), 16);
  }
  return bytes;
};

async function testSync() {
  const action = 'batch_sync';
  const timestamp = Date.now();
  const body = { action, badges: [] };
  const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const messageStr = `daftar-admin:${action}:${timestamp}:${bodyHash}`;
  const messageBytes = new TextEncoder().encode(messageStr);
  
  const privateKeyBytes = hexToBytes(ADMIN_PRIVATE_KEY);
  // nacl.sign.detached expects 64-byte secret key (private + public) or just the 32-byte seed depending on implementation
  // TweetNaCl detached sign expects 64 bytes (seed + pub)
  // Our .env has a 32-byte seed.
  
  // Create 64-byte secret key from 32-byte seed
  const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes.slice(0, 32));
  const signatureBytes = nacl.sign.detached(messageBytes, keyPair.secretKey);
  const signatureHex = Buffer.from(signatureBytes).toString('hex');

  console.log('Sending sync request to http://localhost:3001/api/admin/manage-badge...');
  
  try {
    const res = await fetch('http://localhost:3001/api/admin/manage-badge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-address': ADMIN_WALLET,
        'x-admin-signature': signatureHex,
        'x-admin-timestamp': String(timestamp),
        'x-admin-action': action
      },
      body: JSON.stringify(body)
    });

    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', data);
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

testSync();
