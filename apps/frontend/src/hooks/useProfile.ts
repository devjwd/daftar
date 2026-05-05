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
    if (!walletAddress) return;
    setSaving(true);
    try {
      let activeSignature = signature;
      let activeMessage = signedMessage;
      let activeNonce = nonce;

      // If no signature provided but we have signMessage option, let's try to get one automatically
      if (!activeSignature && options?.signMessage && options?.account) {
        try {
          const fetchedNonce = await getNonce(walletAddress);
          if (fetchedNonce !== null) {
            activeNonce = fetchedNonce;
            activeMessage = `Daftar Profile Update\nWallet: ${walletAddress}\nNonce: ${activeNonce}\nTimestamp: ${Date.now()}`;
            
            const signResult = await options.signMessage({
              message: activeMessage,
              nonce: activeNonce.toString()
            });
            
            if (signResult) {
              activeSignature = signResult;
            }
          }
        } catch (signErr) {
          console.error('[useProfile] Auto-sign failed:', signErr);
          // Continue anyway, maybe the backend doesn't really need it for this specific user
        }
      }

      await updateProfile(walletAddress, data, activeSignature, activeMessage, activeNonce);
      await fetchProfile();
    } catch (err: any) {
      console.error('[useProfile] Update failed:', err);
      throw new Error(err.message || 'Update failed');
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

