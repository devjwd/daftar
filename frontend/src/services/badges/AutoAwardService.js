/**
 * Auto-Award Service
 * 
 * Background service to monitor user activity and automatically
 * trigger badge eligibility checks and awards.
 */
import { getAllBadges, awardBadge } from './badgeStore.js';
import { checkBadgeEligibility } from './engineService.js';

let isChecking = false;

/**
 * Perform a background check for all available badges and award any
 * that the user is eligible for but hasn't received yet.
 * 
 * @param {string} address - Wallet address to check
 * @param {object} options - Optional context (adminAuth, manual trigger flags)
 */
export async function checkAndAwardBadges(address, options = {}) {
  if (!address || isChecking) return { success: false, reason: 'Already checking' };

  try {
    isChecking = true;
    console.log(`[AutoAward] Starting background check for ${address}...`);

    // 1. Get all enabled badges
    const allBadges = getAllBadges().filter(b => b.enabled !== false);
    
    // 2. Fetch user's current awards to skip already earned badges
    // Assuming badgeStore has a way to get earned IDs (already existing)
    const { getEarnedBadgeIds } = await import('./badgeStore.js');
    const earnedIds = getEarnedBadgeIds(address);

    const pendingBadges = allBadges.filter(b => !earnedIds.has(b.id));
    if (pendingBadges.length === 0) {
      return { success: true, awardedCount: 0 };
    }

    let awardedCount = 0;
    
    // 3. Evaluate each pending badge
    for (const badge of pendingBadges) {
      const evaluation = await checkBadgeEligibility(address, badge);
      
      if (evaluation.eligible) {
        console.log(`[AutoAward] User eligible for "${badge.name}". Attempting to award...`);
        
        // 4. Trigger award logic (This calls the backend for verification)
        const result = await awardBadge(address, badge.id, {
           metadata: { 
             autoAwarded: true, 
             triggeredBy: options.triggeredBy || 'system' 
           }
        });

        if (result.success) {
          awardedCount++;
          console.log(`[AutoAward] Successfully awarded "${badge.name}"`);
        }
      }
    }

    return { success: true, awardedCount };
  } catch (error) {
    console.error('[AutoAward] Check failed:', error);
    return { success: false, error: error.message };
  } finally {
    isChecking = false;
  }
}

export default {
  checkAndAwardBadges
};
