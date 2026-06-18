import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { getEnv } from '../config/envValidator';
import './Verify.css';


export default function Verify() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { account, connected, signMessage, connect, wallets } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing verification token. Please return to Discord and click the link again.");
    }
  }, [token]);

  const handleVerify = async () => {
    if (!connected || !account || !token) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Sign a message to prove ownership
      const message = `Verify Discord Account for Daftar\nNonce: ${Date.now()}`;
      const response = await signMessage({
        message,
        nonce: Date.now().toString()
      });

      if (!response) {
        throw new Error("Failed to sign message. Verification cancelled.");
      }

      // Safe hex conversion for Uint8Array or Buffer objects
      const toHex = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') {
          return val.startsWith('0x') ? val : '0x' + val;
        }
        if (val instanceof Uint8Array || (val && typeof val === 'object' && val.constructor?.name === 'Uint8Array')) {
          return '0x' + Array.from(val as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (val && typeof val === 'object' && 'data' in val) {
          return toHex(val.data);
        }
        // Handle JSON stringified Uint8Arrays ({0: 12, 1: 34})
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const keys = Object.keys(val).filter(k => !isNaN(Number(k)));
          if (keys.length > 0) {
            const arr = new Uint8Array(keys.length);
            keys.forEach(k => { arr[Number(k)] = val[k]; });
            return '0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
          }
        }
        // If it was already stringified incorrectly (e.g. "12,34,56")
        if (typeof val === 'string' && val.includes(',')) {
          return '0x' + val.split(',').map(s => Number(s).toString(16).padStart(2, '0')).join('');
        }
        return String(val);
      };

      const finalPublicKey = toHex(account.publicKey);
      const finalSignature = toHex(response.signature);

      const signedMessage = response.fullMessage || message;

      // Ensure address is properly extracted as string
      const addressStr = typeof account.address === 'string' 
        ? account.address 
        : (account.address as any)?.toString?.() || String(account.address);

      // 2. Send to backend
      const apiUrl = getEnv('VITE_API_URL', 'http://localhost:3001');
      const res = await fetch(`${apiUrl}/api/alerts/verify-discord`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: addressStr,
          token,
          signature: {
            publicKey: finalPublicKey,
            signature: finalSignature
          },
          signedMessage,
          nonce: 'discord_verify_' + Date.now() // Unique nonce for rate limiting/replay protection
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to verify Discord account");
      }

      setSuccess(true);
    } catch (err: any) {
      console.error("Verification error:", err);
      setError(err.message || "An unexpected error occurred during verification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="verify-container">
      <div className="verify-card">
        <div className="verify-header">
          <div className="verify-icon">🔐</div>
          <h1 className="verify-title">Daftar Authentication</h1>
          {!success && (
            <p className="verify-subtitle">
              Securely link your wallet to your Discord user profile to claim your roles.
            </p>
          )}
        </div>

        {error && (
          <div className="verify-error">
            {error}
          </div>
        )}

        {success ? (
          <div className="verify-roles">
            <h3 className="verify-roles-title">Verification Complete</h3>
            <div className="verify-role-item" style={{ color: '#00ff00' }}>
              <div className="dot" style={{ background: '#00ff00' }}></div>
              Wallet linked successfully! You can now close this tab and return to Discord.
            </div>
          </div>
        ) : (
          <>
            {token && (
              <div className="verify-roles">
                <h3 className="verify-roles-title">Roles to be granted</h3>
                <div className="verify-role-item">
                  <div className="dot"></div>
                  <div>
                    <strong>Verified</strong>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Standard community access</div>
                  </div>
                </div>
              </div>
            )}

            {!connected ? (
              <button 
                className="verify-button" 
                onClick={() => {
                  if (wallets && wallets.length > 0) connect(wallets[0].name);
                }}
              >
                Connect Wallet to Continue
              </button>
            ) : (
              <button 
                className="verify-button" 
                onClick={handleVerify} 
                disabled={loading || !token}
              >
                {loading ? 'Authenticating...' : 'Sign to Verify'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
