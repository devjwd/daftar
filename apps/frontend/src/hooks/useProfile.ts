import { useState, useEffect, useCallback } from 'react';
import { Profile } from '@daftar/types';
import { getProfile, updateProfile, getNonce } from '../services/api';

interface UseProfileResult {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (data: Partial<Profile>, signature?: string) => Promise<void>;
  getNonce: () => Promise<number | null>;
}

export const useProfile = (walletAddress: string | null): UseProfileResult => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
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

  const handleUpdate = async (data: Partial<Profile>, signature?: string) => {
    if (!walletAddress) return;
    try {
      await updateProfile(walletAddress, data, signature);
      await fetchProfile();
    } catch (err: any) {
      throw new Error(err.message || 'Update failed');
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
    error,
    refresh: fetchProfile,
    update: handleUpdate,
    getNonce: handleGetNonce
  };
};
