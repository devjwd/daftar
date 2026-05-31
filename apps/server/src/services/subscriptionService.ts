import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import {
  resolveEffectiveTier,
  type ProfileTierInput,
  type SubscriptionTier,
} from '@daftar/shared-types';

export type { SubscriptionTier };

export async function getProfileForWallet(
  supabase: SupabaseClient,
  walletAddress: string
): Promise<ProfileTierInput & { wallet_address?: string }> {
  const wallet = normalizeAddress(walletAddress);

  const { data, error } = await supabase
    .from('profiles')
    .select('wallet_address, is_verified, subscription_tier, subscription_expires_at')
    .eq('wallet_address', wallet)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return (
    data || {
      wallet_address: wallet,
      is_verified: false,
      subscription_tier: 'free',
      subscription_expires_at: null,
    }
  );
}

export async function getEffectiveTier(
  supabase: SupabaseClient,
  walletAddress: string
): Promise<SubscriptionTier> {
  const profile = await getProfileForWallet(supabase, walletAddress);
  return resolveEffectiveTier(profile);
}
