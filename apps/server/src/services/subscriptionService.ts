import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import {
  resolveEffectiveTier,
  type ProfileTierInput,
  type SubscriptionTier,
} from '@daftar/shared-types';
import { clearUserAnalyticsData } from './analyticsSyncService.ts';
import { sendDiscordAlert, sendTelegramAlert } from './notificationService.ts';

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

export async function cleanupExpiredSubscriptions(supabase: SupabaseClient) {
  console.log('[SubscriptionService] 🧹 Checking for expired subscriptions...');
  
  // Find profiles where subscription_expires_at is in the past, and tier is not free
  const { data: expiredProfiles, error } = await supabase
    .from('profiles')
    .select('wallet_address, subscription_tier')
    .neq('subscription_tier', 'free')
    .not('subscription_expires_at', 'is', null)
    .lt('subscription_expires_at', new Date().toISOString());

  if (error) {
    console.error('[SubscriptionService] Error fetching expired subscriptions:', error);
    return;
  }

  if (!expiredProfiles || expiredProfiles.length === 0) {
    return;
  }

  console.log(`[SubscriptionService] Found ${expiredProfiles.length} expired subscriptions. Processing...`);

  for (const profile of expiredProfiles) {
    if (!profile.wallet_address) continue;
    const normalized = normalizeAddress(profile.wallet_address);
    
    // 1. Downgrade tier to free
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        subscription_tier: 'free',
        is_verified: false,
        subscription_started_at: null,
        subscription_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('wallet_address', normalized);

    if (updateErr) {
      console.error(`[SubscriptionService] Error downgrading ${normalized}:`, updateErr);
      continue;
    }

    // 2. Clear their data
    try {
      await clearUserAnalyticsData(supabase, normalized);
    } catch (clearErr) {
      console.error(`[SubscriptionService] Error clearing data for expired user ${normalized}:`, clearErr);
    }
  }

  console.log(`[SubscriptionService] ✅ Finished processing expired subscriptions.`);
}

/**
 * Checks for users whose subscription expires within the next 24 hours
 * and sends them a reminder if they haven't been reminded yet.
 */
export async function processSubscriptionReminders(supabase: SupabaseClient) {
  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find profiles where subscription expires within 24h, not free, and reminder not sent
    const { data: expiringProfiles, error } = await supabase
      .from('profiles')
      .select('wallet_address, subscription_tier, subscription_expires_at')
      .neq('subscription_tier', 'free')
      .eq('subscription_reminder_sent', false)
      .not('subscription_expires_at', 'is', null)
      .gt('subscription_expires_at', now.toISOString())
      .lte('subscription_expires_at', tomorrow.toISOString());

    if (error) {
      console.error('[SubscriptionService] Error fetching expiring subscriptions:', error);
      return;
    }

    if (!expiringProfiles || expiringProfiles.length === 0) return;

    for (const profile of expiringProfiles) {
      const { data: config } = await supabase
        .from('user_alert_configs')
        .select('discord_user_id, telegram_chat_id')
        .eq('wallet_address', profile.wallet_address)
        .maybeSingle();

      const webappUrl = process.env.FRONTEND_URL || 'https://daftar.fi';
      const hoursLeft = Math.max(1, Math.floor((new Date(profile.subscription_expires_at).getTime() - now.getTime()) / (1000 * 60 * 60)));
      
      const title = '⚠️ Subscription Expiring Soon';
      const desc = `Your Daftar Premium subscription for wallet \`${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}\` will expire in **${hoursLeft} hours**.`;
      const action = `Renew your subscription now to keep your premium features: ${webappUrl}/settings`;
      
      let notified = false;

      if (config?.discord_user_id) {
        await sendDiscordAlert(config.discord_user_id, title, desc, [{ name: 'Action Required', value: action }]).catch(() => null);
        notified = true;
      }

      if (config?.telegram_chat_id) {
        const text = `<b>${title}</b>\n\n${desc}\n\n${action}`;
        await sendTelegramAlert(config.telegram_chat_id, text).catch(() => null);
        notified = true;
      }

      // Mark as reminded so we don't spam them
      await supabase
        .from('profiles')
        .update({ subscription_reminder_sent: true })
        .eq('wallet_address', profile.wallet_address);
        
      if (notified) {
        console.log(`[SubscriptionService] Sent 24h expiration reminder for ${profile.wallet_address}`);
      }
    }
  } catch (err) {
    console.error('[SubscriptionService] Error processing subscription reminders:', err);
  }
}
