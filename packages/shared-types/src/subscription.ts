export type SubscriptionTier = 'free' | 'lite' | 'pro';

export interface ProfileTierInput {
  is_verified?: boolean | null;
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
}

/**
 * Resolve the effective subscription tier for a profile row.
 * Matches /api/plans/status logic (lite → pro, verified → pro if still free).
 */
export function resolveEffectiveTier(profile: ProfileTierInput | null | undefined): SubscriptionTier {
  if (!profile) return 'free';

  let tier = (profile.subscription_tier || 'free') as SubscriptionTier;

  if (profile.subscription_expires_at) {
    const expiresAt = new Date(profile.subscription_expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
      tier = 'free';
    }
  }

  if (tier === 'lite') {
    tier = 'pro';
  }

  if (profile.is_verified && tier === 'free') {
    tier = 'pro';
  }

  return tier === 'pro' ? 'pro' : 'free';
}

export function isPremiumTier(tier: SubscriptionTier): boolean {
  return tier !== 'free';
}
