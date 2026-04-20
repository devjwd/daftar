/**
 * Profile Service
 * Handles storage and retrieval of user profiles
 * Uses localStorage for now, can be easily upgraded to backend/IPFS
 */

import { createProfileMigrationProofHeaders } from './profileProof';

const PROFILE_PREFIX = 'move_profile_';
const PROFILES_INDEX = 'move_profiles_index';
const PROFILE_EDIT_KEY_PREFIX = 'move_profile_edit_key_';
const API_BASE = '';

/**
 * Normalize address to consistent format
 */
export const normalizeAddress = (address) => {
  if (!address) return null;
  
  // Handle different address types from wallet adapters
  if (typeof address === 'string') {
    return address.toLowerCase().trim();
  }
  
  if (address.toString && typeof address.toString === 'function') {
    return address.toString().toLowerCase().trim();
  }
  
  return String(address).toLowerCase().trim();
};

/**
 * Validate profile data
 */
const validateProfile = (profile) => {
  if (!profile.address) {
    throw new Error('Profile must have an address');
  }
  
  // Validate username length
  if (profile.username && profile.username.length > 50) {
    throw new Error('Username must be 50 characters or less');
  }
  
  // Validate bio length
  if (profile.bio && profile.bio.length > 500) {
    throw new Error('Bio must be 500 characters or less');
  }
  
  return true;
};

/**
 * Convert image file to base64
 */
export const imageToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image'));
      return;
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Image must be smaller than 2MB'));
      return;
    }
    
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Compress and resize image
 */
export const compressImage = (base64Image, maxWidth = 400, maxHeight = 400) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Calculate new dimensions
      if (width > height) {
        if (width > maxWidth) {
          height = height * (maxWidth / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = width * (maxHeight / height);
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = base64Image;
  });
};

/**
 * Get profile by address
 */
export const getProfile = (address) => {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;
  
  try {
    const key = PROFILE_PREFIX + normalizedAddress;
    const data = localStorage.getItem(key);
    
    if (!data) return null;
    
    const profile = JSON.parse(data);
    return {
      ...profile,
      address: normalizedAddress,
    };
  } catch (error) {
    console.error('Error getting profile:', error);
    return null;
  }
};

/**
 * Save profile
 */
export const saveProfile = async (profileData) => {
  try {
    const normalizedAddress = normalizeAddress(profileData.address);
    if (!normalizedAddress) {
      throw new Error('Invalid address');
    }
    
    const profile = {
      address: normalizedAddress,
      username: profileData.username || '',
      bio: profileData.bio || '',
      avatar_url: profileData.avatar_url || profileData.pfp || null,
      twitter: profileData.twitter || '',
      telegram: profileData.telegram || '',
      updatedAt: new Date().toISOString(),
      createdAt: profileData.createdAt || new Date().toISOString(),
    };
    
    validateProfile(profile);
    
    const key = PROFILE_PREFIX + normalizedAddress;
    localStorage.setItem(key, JSON.stringify(profile));
    
    // Update profiles index
    updateProfilesIndex(normalizedAddress);
    
    return profile;
  } catch (error) {
    console.error('Error saving profile:', error);
    throw error;
  }
};

/**
 * Update profiles index for listing
 */
const updateProfilesIndex = (address) => {
  try {
    const indexData = localStorage.getItem(PROFILES_INDEX);
    let index = indexData ? JSON.parse(indexData) : [];
    
    if (!index.includes(address)) {
      index.push(address);
      localStorage.setItem(PROFILES_INDEX, JSON.stringify(index));
    }
  } catch (error) {
    console.error('Error updating profiles index:', error);
  }
};

/**
 * Get all profiles
 */
export const getAllProfiles = () => {
  try {
    const indexData = localStorage.getItem(PROFILES_INDEX);
    if (!indexData) return [];
    
    const addresses = JSON.parse(indexData);
    return addresses
      .map(addr => getProfile(addr))
      .filter(profile => profile !== null);
  } catch (error) {
    console.error('Error getting all profiles:', error);
    return [];
  }
};

/**
 * Delete profile
 */
export const deleteProfile = (address) => {
  try {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) return false;
    
    const key = PROFILE_PREFIX + normalizedAddress;
    localStorage.removeItem(key);
    
    // Remove from index
    const indexData = localStorage.getItem(PROFILES_INDEX);
    if (indexData) {
      let index = JSON.parse(indexData);
      index = index.filter(addr => addr !== normalizedAddress);
      localStorage.setItem(PROFILES_INDEX, JSON.stringify(index));
    }

    const editKeyStorageKey = PROFILE_EDIT_KEY_PREFIX + normalizedAddress;
    localStorage.removeItem(editKeyStorageKey);
    try {
      sessionStorage.removeItem(editKeyStorageKey);
    } catch {
      // ignore sessionStorage cleanup failures
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting profile:', error);
    return false;
  }
};

/**
 * Search profiles by username
 */
export const searchProfiles = (query) => {
  if (!query) return [];
  
  const allProfiles = getAllProfiles();
  const lowerQuery = query.toLowerCase();
  
  return allProfiles.filter(profile => {
    return (
      profile.username?.toLowerCase().includes(lowerQuery) ||
      profile.address?.toLowerCase().includes(lowerQuery) ||
      profile.bio?.toLowerCase().includes(lowerQuery)
    );
  });
};

/**
 * Find profile by exact username match
 */
export const getProfileByUsername = (username) => {
  if (!username) return null;
  
  const allProfiles = getAllProfiles();
  const lowerUsername = username.toLowerCase();
  
  return allProfiles.find(profile => 
    profile.username?.toLowerCase() === lowerUsername
  ) || null;
};

/**
 * Search for address or username and return address
 */
export const resolveAddressOrUsername = (query) => {
  if (!query) return null;
  
  const trimmedQuery = query.trim();
  
  // Check if it's a valid address format
  if (trimmedQuery.startsWith('0x')) {
    return normalizeAddress(trimmedQuery);
  }
  
  // Otherwise search by username
  const profile = getProfileByUsername(trimmedQuery);
  return profile ? profile.address : null;
};

/**
 * Export profile data (for backup or migration)
 */
export const exportProfile = (address) => {
  const profile = getProfile(address);
  if (!profile) return null;
  
  return {
    ...profile,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };
};

/**
 * Import profile data
 */
export const importProfile = async (profileData) => {
  try {
    if (!profileData.address) {
      throw new Error('Invalid profile data');
    }
    
    return await saveProfile(profileData);
  } catch (error) {
    console.error('Error importing profile:', error);
    throw error;
  }
};

const safeJson = async (res) => {
  if (!res || !res.ok) {
    try {
      await res.text();
    } catch {
      return null;
    }
    return null;
  }
  return res.json();
};

const cacheProfile = (profile) => {
  if (!profile?.address) return;
  const normalizedAddress = normalizeAddress(profile.address);
  if (!normalizedAddress) return;

  const key = PROFILE_PREFIX + normalizedAddress;
  localStorage.setItem(
    key,
    JSON.stringify({
      ...profile,
      address: normalizedAddress,
    })
  );
  updateProfilesIndex(normalizedAddress);
};

const cacheProfiles = (profiles) => {
  if (!Array.isArray(profiles)) return;
  profiles.forEach((profile) => cacheProfile(profile));
};

const getStoredEditKey = (address) => {
  const key = PROFILE_EDIT_KEY_PREFIX + address;

  try {
    const sessionValue = sessionStorage.getItem(key) || '';
    if (sessionValue) {
      return sessionValue;
    }
  } catch {
    // ignore sessionStorage access failures
  }

  try {
    const legacyValue = localStorage.getItem(key) || '';
    if (legacyValue) {
      try {
        sessionStorage.setItem(key, legacyValue);
      } catch {
        // ignore sessionStorage migration failures
      }
      localStorage.removeItem(key);
      return legacyValue;
    }
  } catch {
    // ignore localStorage access failures
  }

  return '';
};

const storeEditKey = (address, editKey) => {
  if (!address || !editKey) return;
  const key = PROFILE_EDIT_KEY_PREFIX + address;

  try {
    sessionStorage.setItem(key, String(editKey));
  } catch {
    // ignore sessionStorage write failures
  }

  try {
    localStorage.removeItem(key);
  } catch {
    // ignore localStorage cleanup failures
  }
};

const shouldFallbackToLocalProfileStore = (status) => status === 404 || status === 405;

const isLegacyProfileMigrationError = (status, message) => status === 409 && /missing an edit key/i.test(String(message || ''));

const readErrorPayload = async (res, fallbackMessage) => {
  let message = fallbackMessage;

  try {
    const err = await res.json();
    if (err?.error) message = err.error;
  } catch {
    try {
      const text = await res.text();
      if (text) {
        const trimmed = text.trim();
        message = trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
      }
    } catch {
      // no-op
    }
  }

  return message;
};

const createMigrationHeaders = async ({ migrationAuth, action, body, address }) => {
  if (!migrationAuth?.account || typeof migrationAuth?.signMessage !== 'function') {
    throw new Error('Connect the matching wallet and approve the migration signature request');
  }

  return createProfileMigrationProofHeaders({
    account: migrationAuth.account,
    signMessage: migrationAuth.signMessage,
    action,
    body,
    address,
  });
};

export const getProfileAsync = async (address) => {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;

  try {
    const res = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(normalizedAddress)}`);
    const remote = await safeJson(res);
    if (remote && remote.address) {
      cacheProfile(remote);
      return {
        ...remote,
        address: normalizedAddress,
      };
    }
  } catch (error) {
    console.warn('getProfileAsync remote fetch failed:', error);
  }

  return getProfile(normalizedAddress);
};

export const saveProfileAsync = async (profileData, migrationAuth = null) => {
  const normalizedAddress = normalizeAddress(profileData?.address);
  if (!normalizedAddress) {
    throw new Error('Invalid address');
  }

  const profile = {
    address: normalizedAddress,
    username: profileData.username || '',
    bio: profileData.bio || '',
    avatar_url: profileData.avatar_url || profileData.pfp || null,
    twitter: profileData.twitter || '',
    telegram: profileData.telegram || '',
    updatedAt: new Date().toISOString(),
    createdAt: profileData.createdAt || new Date().toISOString(),
  };

  validateProfile(profile);
  const editKey = getStoredEditKey(normalizedAddress);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(editKey ? { 'x-profile-edit-key': editKey } : {}),
      },
      body: JSON.stringify({ ...profile, ...(editKey ? { editKey } : {}) }),
    });
  } catch (error) {
    console.warn('saveProfileAsync remote save failed, falling back to local storage:', error);
    const localProfile = await saveProfile(profile);
    cacheProfile(localProfile);
    return localProfile;
  }

  if (shouldFallbackToLocalProfileStore(res.status)) {
    const localProfile = await saveProfile(profile);
    cacheProfile(localProfile);
    return localProfile;
  }

  if (!res.ok) {
    const message = await readErrorPayload(res, `Profile save failed (HTTP ${res.status})`);

    if (isLegacyProfileMigrationError(res.status, message)) {
      const migrationHeaders = await createMigrationHeaders({
        migrationAuth,
        action: 'profile-migrate-save',
        body: profile,
        address: normalizedAddress,
      });

      const retry = await fetch(`${API_BASE}/api/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...migrationHeaders,
        },
        body: JSON.stringify(profile),
      });

      if (!retry.ok) {
        throw new Error(await readErrorPayload(retry, `Profile save failed (HTTP ${retry.status})`));
      }

      const remote = await retry.json();
      if (!remote || !remote.address) {
        throw new Error('Profile save failed: invalid server response');
      }

      if (remote.editKey) {
        storeEditKey(normalizedAddress, remote.editKey);
      }

      const { editKey: _editKey, ...publicProfile } = remote;
      cacheProfile(publicProfile);
      return publicProfile;
    }

    throw new Error(message);
  }

  const remote = await res.json();
  if (!remote || !remote.address) {
    throw new Error('Profile save failed: invalid server response');
  }

  if (remote.editKey) {
    storeEditKey(normalizedAddress, remote.editKey);
  }

  const { editKey: _editKey, ...publicProfile } = remote;

  cacheProfile(publicProfile);
  return publicProfile;
};

export const deleteProfileAsync = async (address, migrationAuth = null) => {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return false;
  const editKey = getStoredEditKey(normalizedAddress);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(normalizedAddress)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(editKey ? { 'x-profile-edit-key': editKey } : {}),
      },
      body: JSON.stringify({ ...(editKey ? { editKey } : {}) }),
    });
  } catch (error) {
    console.warn('deleteProfileAsync remote delete failed, falling back to local storage:', error);
    return deleteProfile(normalizedAddress);
  }

  if (shouldFallbackToLocalProfileStore(res.status)) {
    return deleteProfile(normalizedAddress);
  }

  if (!res.ok) {
    const message = await readErrorPayload(res, `Profile delete failed (HTTP ${res.status})`);

    if (isLegacyProfileMigrationError(res.status, message)) {
      const migrationHeaders = await createMigrationHeaders({
        migrationAuth,
        action: 'profile-migrate-delete',
        body: {},
        address: normalizedAddress,
      });

      const retry = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(normalizedAddress)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...migrationHeaders,
        },
        body: JSON.stringify({}),
      });

      if (!retry.ok) {
        throw new Error(await readErrorPayload(retry, `Profile delete failed (HTTP ${retry.status})`));
      }

      const payload = await retry.json().catch(() => ({ deleted: true }));
      if (payload?.deleted === false) {
        return false;
      }

      return deleteProfile(normalizedAddress);
    }

    throw new Error(message);
  }

  const payload = await res.json().catch(() => ({ deleted: true }));
  if (payload?.deleted === false) {
    return false;
  }

  return deleteProfile(normalizedAddress);
};

export const getAllProfilesAsync = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/profiles`);
    const remote = await safeJson(res);
    if (Array.isArray(remote)) {
      cacheProfiles(remote);
      return remote;
    }
  } catch (error) {
    console.warn('getAllProfilesAsync remote fetch failed:', error);
  }

  return getAllProfiles();
};

export const searchProfilesAsync = async (query) => {
  if (!query) return [];

  try {
    const qs = new URLSearchParams({ query, limit: '20' });
    const res = await fetch(`${API_BASE}/api/profiles?${qs.toString()}`);
    const remote = await safeJson(res);
    if (Array.isArray(remote)) {
      cacheProfiles(remote);
      return remote;
    }
  } catch (error) {
    console.warn('searchProfilesAsync remote search failed:', error);
  }

  return searchProfiles(query);
};

export const getProfileByUsernameAsync = async (username) => {
  if (!username) return null;
  const lowerUsername = username.toLowerCase();
  const results = await searchProfilesAsync(username);
  return results.find((profile) => profile.username?.toLowerCase() === lowerUsername) || null;
};

export const resolveAddressOrUsernameAsync = async (query) => {
  if (!query) return null;

  const trimmedQuery = query.trim();
  if (trimmedQuery.startsWith('0x')) {
    return normalizeAddress(trimmedQuery);
  }

  const profile = await getProfileByUsernameAsync(trimmedQuery);
  return profile ? profile.address : null;
};
