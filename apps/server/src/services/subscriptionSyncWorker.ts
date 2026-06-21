import { SupabaseClient } from '@supabase/supabase-js';
import { getDiscordClient } from '../bots/discord/discordBot.ts';
import { getEffectiveTier } from './subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';

/**
 * Periodically checks all linked Discord accounts and revokes the Pro role
 * if their on-chain subscription is no longer active.
 */
export const startSubscriptionSyncWorker = (supabaseAdmin: SupabaseClient | null) => {
  if (!supabaseAdmin) {
    console.warn('[SyncWorker] Missing Supabase client, aborting.');
    return;
  }

  // Run the check every 24 hours (86400000 ms)
  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  console.log(`[SyncWorker] Starting Discord Subscription Sync loop (Interval: ${INTERVAL_MS / 1000}s)`);

  const runSync = async () => {
    try {
      const discordClient = getDiscordClient();
      if (!discordClient) {
        console.warn('[SyncWorker] Discord client not initialized yet. Skipping sync.');
        return;
      }

      const guilds = discordClient.guilds.cache;
      if (!guilds || guilds.size === 0) return;

      // Fetch all users who have linked their Discord account
      const { data: configs, error } = await supabaseAdmin
        .from('user_alert_configs')
        .select('wallet_address, discord_user_id')
        .not('discord_user_id', 'is', null);

      if (error) {
        throw error;
      }

      let revokedCount = 0;

      // Check each linked user's subscription tier
      for (const config of configs) {
        if (!config.wallet_address || !config.discord_user_id) continue;

        try {
          const tier = await getEffectiveTier(supabaseAdmin, config.wallet_address);
          
          if (!isPremiumTier(tier)) {
            let userNotified = false;

            for (const [_, guild] of guilds) {
              const proRole = guild.roles.cache.find((r: any) => r.name.toLowerCase() === 'pro');
              if (!proRole) continue;

              const member = await guild.members.fetch(config.discord_user_id).catch(() => null);
              if (member && member.roles.cache.has(proRole.id)) {
                await member.roles.remove(proRole).catch(console.error);
                revokedCount++;
                console.log(`[SyncWorker] Revoked Pro role from ${config.discord_user_id} in ${guild.id} - Subscription Expired`);

                // Notify the user via DM only once
                if (!userNotified) {
                  const webappUrl = process.env.FRONTEND_URL || 'https://daftar.fi';
                  await member.send({
                    content: `⚠️ **Subscription Expired**\nYour Daftar Premium subscription for wallet \`${config.wallet_address.slice(0, 6)}...${config.wallet_address.slice(-4)}\` has expired.\n\nYour \`Pro\` Discord roles have been removed. To regain access to premium features, please renew your subscription here: ${webappUrl}/settings`
                  }).catch(() => null);
                  userNotified = true;
                }
              }
            }
          }
        } catch (err: any) {
          console.error(`[SyncWorker] Error checking tier for ${config.wallet_address}:`, err.message);
        }
      }

      if (revokedCount > 0) {
        console.log(`[SyncWorker] Daily sync complete. Revoked Pro roles ${revokedCount} times.`);
      }

    } catch (err) {
      console.error('[SyncWorker] Global error during sync loop:', err);
    }
  };

  // Run immediately on startup
  setTimeout(runSync, 10000); // 10 seconds after startup to ensure bots are connected

  // Then run on interval
  setInterval(runSync, INTERVAL_MS);
};
