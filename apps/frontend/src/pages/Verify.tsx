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

      // Format based on Aptos Wallet Adapter standard
      const signature = typeof response.signature === 'string' 
        ? response.signature 
        : ('data' in response.signature ? (response.signature as any).data : String(response.signature));
      
      const signedMessage = response.fullMessage || message;

      // 2. Send to backend
      const apiUrl = getEnv('VITE_API_URL', 'http://localhost:3001');
      const res = await fetch(`${apiUrl}/api/alerts/verify-discord`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: account.address,
          token,
          signature,
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
