// Admin Service: Manages token and badge data persistence
// Uses localStorage for persistence (can be replaced with backend later)

const ADMIN_STORAGE_KEY = 'movement_admin_data';

// Load admin data from localStorage
export const loadAdminData = () => {
  try {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!stored) {
      return {
        tokens: [],
        badges: [],
      };
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load admin data:', error);
    return {
      tokens: [],
      badges: [],
    };
  }
};

// Save admin data to localStorage
export const saveAdminData = (data) => {
  try {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to save admin data:', error);
    return false;
  }
};

// Add a new token
export const addToken = (token) => {
  const data = loadAdminData();
  
  // Validate required fields
  if (!token.address || !token.symbol || !token.name) {
    throw new Error('Missing required fields: address, symbol, name');
  }
  
  // Check for duplicates
  if (data.tokens.some(t => t.address.toLowerCase() === token.address.toLowerCase())) {
    throw new Error('Token with this address already exists');
  }
  
  // Add timestamp and ID
  const newToken = {
    ...token,
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    decimals: token.decimals || 8,
    isNative: token.isNative || false,
  };
  
  data.tokens.push(newToken);
  saveAdminData(data);
  
  return newToken;
};

// Update token
export const updateToken = (tokenId, updates) => {
  const data = loadAdminData();
  const index = data.tokens.findIndex(t => t.id === tokenId);
  
  if (index === -1) {
    throw new Error('Token not found');
  }
  
  data.tokens[index] = {
    ...data.tokens[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  saveAdminData(data);
  return data.tokens[index];
};

// Delete token
export const deleteToken = (tokenId) => {
  const data = loadAdminData();
  data.tokens = data.tokens.filter(t => t.id !== tokenId);
  saveAdminData(data);
};

// Get all custom tokens
export const getCustomTokens = () => {
  const data = loadAdminData();
  return data.tokens;
};

// Add a new badge
export const addBadge = (badge) => {
  const data = loadAdminData();
  
  // Validate required fields
  if (!badge.name || !badge.description || !badge.icon) {
    throw new Error('Missing required fields: name, description, icon');
  }
  
  // Check for duplicates
  if (data.badges.some(b => b.name.toLowerCase() === badge.name.toLowerCase())) {
    throw new Error('Badge with this name already exists');
  }
  
  // Generate next ID
  const maxId = data.badges.length > 0 ? Math.max(...data.badges.map(b => b.id)) : 0;
  
  const newBadge = {
    ...badge,
    id: maxId + 1,
    createdAt: new Date().toISOString(),
    earned: badge.earned || false,
  };
  
  data.badges.push(newBadge);
  saveAdminData(data);
  
  return newBadge;
};

// Update badge
export const updateBadge = (badgeId, updates) => {
  const data = loadAdminData();
  const index = data.badges.findIndex(b => b.id === badgeId);
  
  if (index === -1) {
    throw new Error('Badge not found');
  }
  
  data.badges[index] = {
    ...data.badges[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  saveAdminData(data);
  return data.badges[index];
};

// Delete badge
export const deleteBadge = (badgeId) => {
  const data = loadAdminData();
  data.badges = data.badges.filter(b => b.id !== badgeId);
  saveAdminData(data);
};

// Get all custom badges
export const getCustomBadges = () => {
  const data = loadAdminData();
  return data.badges;
};

// Export admin data (for backup)
export const exportAdminData = () => {
  const data = loadAdminData();
  return JSON.stringify(data, null, 2);
};

// Import admin data (for restore)
export const importAdminData = (jsonData) => {
  try {
    const data = JSON.parse(jsonData);
    
    // Validate structure
    if (!Array.isArray(data.tokens) || !Array.isArray(data.badges)) {
      throw new Error('Invalid data structure');
    }
    
    saveAdminData(data);
    return true;
  } catch (error) {
    console.error('Failed to import admin data:', error);
    throw error;
  }
};

// Clear all custom data
export const clearAllAdminData = () => {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
};
