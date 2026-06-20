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

      const guildId = process.env.DISCORD_GUILD_ID;
      const proRoleId = process.env.DISCORD_PRO_ROLE_ID;

      if (!guildId || !proRoleId) {
        console.warn('[SyncWorker] DISCORD_GUILD_ID or DISCORD_PRO_ROLE_ID missing. Skipping sync.');
        return;
      }

      const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        console.warn('[SyncWorker] Could not fetch Discord guild. Skipping sync.');
        return;
      }

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
            // User does not have a premium tier, ensure they don't have the Pro role
            const member = await guild.members.fetch(config.discord_user_id).catch(() => null);
            if (member && member.roles.cache.has(proRoleId)) {
              await member.roles.remove(proRoleId);
              revokedCount++;
              console.log(`[SyncWorker] Revoked Pro role from ${config.discord_user_id} (${config.wallet_address}) - Subscription Expired`);

              // Notify the user via DM
              const webappUrl = process.env.FRONTEND_URL || 'https://daftar.fi';
              await member.send({
                content: `⚠️ **Subscription Expired**\nYour Daftar Premium subscription for wallet \`${config.wallet_address.slice(0, 6)}...${config.wallet_address.slice(-4)}\` has expired.\n\nYour \`Pro\` Discord roles have been removed. To regain access to premium features, please renew your subscription here: ${webappUrl}/settings`
              }).catch(() => null);
            }
          }
        } catch (err: any) {
          console.error(`[SyncWorker] Error checking tier for ${config.wallet_address}:`, err.message);
        }
      }

      if (revokedCount > 0) {
        console.log(`[SyncWorker] Daily sync complete. Revoked Pro role from ${revokedCount} users.`);
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
