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

      // If no signature provided but we have signMessage option, let's try to get one automatically
      if (!activeSignature && options?.signMessage && options?.account) {
        console.log('[useProfile] Signature required, triggering automated signing flow...');
        try {
          const fetchedNonce = await getNonce(walletAddress);
          console.log('[useProfile] Fetched nonce:', fetchedNonce);
          
          if (fetchedNonce !== null) {
            activeNonce = fetchedNonce;
            activeMessage = `Daftar Profile Update\nWallet: ${walletAddress}\nNonce: ${activeNonce}\nTimestamp: ${Date.now()}`;
            
            console.log('[useProfile] Requesting signature for message:', activeMessage);
            const signResult = await options.signMessage({
              message: activeMessage,
              nonce: activeNonce.toString()
            });
            
            console.log('[useProfile] Sign result received:', signResult);
            
            if (signResult) {
              // Construct the payload the backend expects (publicKey + signature)
              activeSignature = {
                signature: typeof signResult === 'object' ? (signResult.signature || signResult.sig) : signResult,
                publicKey: options.account.publicKey?.toString() || options.account.publicKey
              };
              
              // If the wallet provided a fullMessage (prefixed), use that as it's what was actually signed
              if (typeof signResult === 'object' && signResult.fullMessage) {
                activeMessage = signResult.fullMessage;
                console.log('[useProfile] Using fullMessage for verification:', activeMessage);
              }
              
              console.log('[useProfile] Final signature payload:', activeSignature);
            }
          } else {
            console.warn('[useProfile] Failed to fetch nonce, proceeding without signature');
          }
        } catch (signErr: any) {
          console.error('[useProfile] Auto-sign failed or cancelled:', signErr);
          // If user cancelled, we should probably stop here
          if (signErr?.message?.includes('User rejected') || signErr?.name === 'UserRejectedError') {
            throw new Error('Signature request was rejected');
          }
        }
      } else {
        console.log('[useProfile] Skipping auto-sign. Status:', {
          hasSignature: !!activeSignature,
          hasSignMessage: !!options?.signMessage,
          hasAccount: !!options?.account
        });
      }

      console.log('[useProfile] Calling api.updateProfile...');
      const updated = await updateProfile(walletAddress, data, activeSignature, activeMessage, activeNonce);
      console.log('[useProfile] Update successful:', updated);
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

