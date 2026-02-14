import { useState, useEffect, useCallback } from 'react';
import {
  getProfile,
  saveProfile,
  deleteProfile,
  getAllProfiles,
  searchProfiles,
  normalizeAddress,
  imageToBase64,
  compressImage,
} from '../services/profileService';

/**
 * Hook to manage user profile
 */
export const useProfile = (address) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load profile when address changes
  useEffect(() => {
    if (!address) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const loadedProfile = getProfile(address);
      setProfile(loadedProfile);
    } catch (err) {
      setError(err.message);
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Save profile
  const updateProfile = useCallback(async (profileData) => {
    if (!address) {
      throw new Error('No address provided');
    }

    setSaving(true);
    setError(null);

    try {
      const updatedProfile = await saveProfile({
        ...profileData,
        address,
        createdAt: profile?.createdAt,
      });
      
      setProfile(updatedProfile);
      return updatedProfile;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [address, profile?.createdAt]);

  // Upload profile picture
  const uploadProfilePicture = useCallback(async (file) => {
    try {
      const base64 = await imageToBase64(file);
      const compressed = await compressImage(base64);
      return compressed;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Remove profile picture
  const removeProfilePicture = useCallback(async () => {
    if (!profile) return;

    return await updateProfile({
      ...profile,
      pfp: null,
    });
  }, [profile, updateProfile]);

  // Delete entire profile
  const remove = useCallback(async () => {
    if (!address) return false;

    try {
      const success = deleteProfile(address);
      if (success) {
        setProfile(null);
      }
      return success;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [address]);

  return {
    profile,
    loading,
    error,
    saving,
    updateProfile,
    uploadProfilePicture,
    removeProfilePicture,
    deleteProfile: remove,
  };
};

/**
 * Hook to get a profile for any address (read-only)
 */
export const useProfileByAddress = (address) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    
    try {
      const loadedProfile = getProfile(address);
      setProfile(loadedProfile);
    } catch (err) {
      console.error('Error loading profile:', err);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  return { profile, loading };
};

/**
 * Hook to search profiles
 */
export const useProfileSearch = () => {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback((query) => {
    setSearching(true);
    
    try {
      const profiles = searchProfiles(query);
      setResults(profiles);
    } catch (err) {
      console.error('Error searching profiles:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  return { results, searching, search };
};

/**
 * Hook to get all profiles
 */
export const useAllProfiles = () => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    
    try {
      const allProfiles = getAllProfiles();
      setProfiles(allProfiles);
    } catch (err) {
      console.error('Error loading all profiles:', err);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    try {
      const allProfiles = getAllProfiles();
      setProfiles(allProfiles);
    } catch (err) {
      console.error('Error refreshing profiles:', err);
    }
  }, []);

  return { profiles, loading, refresh };
};
