/**
 * Profile Service
 * Handles storage and retrieval of user profiles
 * Uses localStorage for now, can be easily upgraded to backend/IPFS
 */

const PROFILE_PREFIX = 'move_profile_';
const PROFILES_INDEX = 'move_profiles_index';

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
      pfp: profileData.pfp || null,
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
