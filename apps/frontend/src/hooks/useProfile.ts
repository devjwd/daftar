import { useState, useEffect, useCallback } from 'react';
import { Profile } from '@daftar/types';
import { getProfile, updateProfile, getNonce } from '../services/api';

interface UseProfileResult {
  profile: Profile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateProfile: (data: Partial<Profile>, signature?: any, signedMessage?: string, nonce?: number) => Promise<void>;
  update: (data: Partial<Profile>, signature?: any, signedMessage?: string, nonce?: number) => Promise<void>;
  getNonce: () => Promise<number | null>;
}

export const useProfile = (walletAddress: string | null, options: any = {}): UseProfileResult => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!walletAddress) {
      setProfile(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getProfile(walletAddress);
      setProfile(data);
    } catch (err: any) {
      console.error('[useProfile] Fetch failed:', err);
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  const handleUpdate = async (data: Partial<Profile>, signature?: any, signedMessage?: string, nonce?: number) => {
    if (!walletAddress) {
      console.warn('[useProfile] No wallet address, cannot update');
      return;
    }
    
    setSaving(true);
    setError(null);
    console.log('[useProfile] Starting handleUpdate for', walletAddress);
    
    try {
      let activeSignature = signature;
      let activeMessage = signedMessage;
      let activeNonce = nonce;

      // 1. Mandatory Signing Flow
      // If no signature provided, we MUST get one because the backend requires it
      if (!activeSignature) {
        if (!options?.signMessage || !options?.account) {
          throw new Error('Wallet not fully connected. Please reconnect your wallet.');
        }

        console.log('[useProfile] Signature required, triggering automated signing flow...');
        
        // Fetch fresh nonce from backend
        const fetchedNonce = await getNonce(walletAddress);
        if (fetchedNonce === null) {
          throw new Error('Failed to fetch security nonce from server. Please check your connection.');
        }

        activeNonce = fetchedNonce;
        // Create a clear, user-friendly message for signing
        const timestamp = new Date().toISOString();
        activeMessage = `Daftar Profile Update\nWallet: ${walletAddress}\nNonce: ${activeNonce}\nTimestamp: ${timestamp}`;
        
        console.log('[useProfile] Requesting signature for message:', activeMessage);
        
        try {
          const signResult = await options.signMessage({
            message: activeMessage,
            nonce: activeNonce.toString()
          });
          
          console.log('[useProfile] Sign result received:', signResult);
          
          if (!signResult) {
            throw new Error('Signature request was cancelled or failed.');
          }

          // Extract public key (Aptos standard)
          const publicKey = options.account.publicKey?.toString() || options.account.publicKey;
          
          // Construct the payload the backend expects
          // Some wallets return result directly, others return { signature, message, ... }
          const rawSignature = typeof signResult === 'object' 
            ? (signResult.signature || signResult.sig) 
            : signResult;

          if (!rawSignature) {
            throw new Error('No signature returned from wallet.');
          }

          activeSignature = {
            signature: rawSignature,
            publicKey: publicKey
          };
          
          // Use the fullMessage if provided by the wallet (Aptos standard for prefixed messages)
          if (typeof signResult === 'object' && signResult.fullMessage) {
            activeMessage = signResult.fullMessage;
          }
          
          console.log('[useProfile] Signature successfully obtained');
        } catch (signErr: any) {
          console.error('[useProfile] Signing failed:', signErr);
          if (signErr?.message?.includes('rejected') || signErr?.name === 'UserRejectedError') {
            throw new Error('Signature request was rejected by user.');
          }
          throw new Error(`Signing failed: ${signErr.message || 'Unknown error'}`);
        }
      }

      console.log('[useProfile] Calling api.updateProfile with signature...');
      const updated = await updateProfile(walletAddress, data, activeSignature, activeMessage, activeNonce);
      
      console.log('[useProfile] Update successful:', updated);
      setProfile(updated);
      await fetchProfile();
    } catch (err: any) {
      console.error('[useProfile] Update failed:', err);
      const msg = err.message || 'Update failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleGetNonce = async () => {
    if (!walletAddress) return null;
    try {
      return await getNonce(walletAddress);
    } catch (err) {
      return null;
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    saving,
    error,
    refresh: fetchProfile,
    updateProfile: handleUpdate,
    update: handleUpdate,
    getNonce: handleGetNonce
  };
};

export const useProfileByAddress = (address: string | null) => useProfile(address);

