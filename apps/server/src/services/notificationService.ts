import { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveTier } from './subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';
import { Resend } from 'resend';
import { getTelegramBot } from '../bots/telegram/telegramBot.ts';
import { getDiscordClient } from '../bots/discord/discordBot.ts';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmailAlert(to: string, subject: string, html: string) {
  if (resend) {
    try {
      await resend.emails.send({
        from: 'Daftar Alerts <alerts@daftar.fi>',
        to,
        subject,
        html,
      });
      console.log(`[NotificationService] Email sent successfully to ${to}`);
    } catch (err) {
      console.error('[NotificationService] Email failed to send:', err);
    }
  } else {
    console.log(`[NotificationService] [MOCK EMAIL to ${to}]: ${subject}\nHTML length: ${html.length}`);
  }
}

export async function sendTelegramAlert(chatId: string, text: string) {
  const bot = getTelegramBot();
  if (bot) {
    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      console.log(`[NotificationService] Telegram message sent to chat ID ${chatId}`);
    } catch (err) {
      console.error('[NotificationService] Telegram alert failed:', err);
    }
  } else {
    console.warn('[NotificationService] Telegram bot not initialized');
  }
}

export async function sendDiscordAlert(userId: string, title: string, description: string, fields: { name: string; value: string; inline?: boolean }[]) {
  const client = getDiscordClient();
  if (client) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [{
          title,
          description,
          fields,
          color: 0xD4AF37, // Gold accent color for pro users
          timestamp: new Date().toISOString(),
        }]
      });
      console.log(`[NotificationService] Discord DM sent to user ${userId}`);
    } catch (err) {
      console.error('[NotificationService] Discord alert failed:', err);
    }
  } else {
    console.warn('[NotificationService] Discord client not initialized');
  }
}

export async function dispatchAlertsForTransactions(
  supabase: SupabaseClient,
  walletAddress: string,
  transactions: any[]
) {
  try {
    const tier = await getEffectiveTier(supabase, walletAddress);
    if (!isPremiumTier(tier)) {
      return; // Alerts are only for premium users
    }

    const { data: config, error } = await supabase
      .from('user_alert_configs')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error) {
      console.error(`[NotificationService] Failed to load alert config for ${walletAddress}:`, error);
      return;
    }

    if (!config) {
      return; // No config set up
    }

    for (const tx of transactions) {
      const valueUsd = tx.value_usd ? Number(tx.value_usd) : 0;
      if (valueUsd < Number(config.min_amount_usd)) {
        continue; // Doesn't meet minimum value threshold
      }

      let matchesType = false;
      if (tx.action === 'RECEIVED' && config.alert_on_received) matchesType = true;
      if (tx.action === 'SEND' && config.alert_on_withdrawal) matchesType = true;
      if (tx.action === 'SWAP' && config.alert_on_swaps) matchesType = true;
      if (tx.metadata?.success === false && config.alert_on_failed) matchesType = true;

      if (!matchesType) continue;

      // Construct notification strings
      const txHashTruncated = tx.hash ? `${tx.hash.slice(0, 6)}...${tx.hash.slice(-4)}` : '';
      const actionText = tx.description || `${tx.action} transaction`;

      const alertMessage = `<b>🚨 Daftar Alert: Transaction Detected</b>\n\n` +
        `• <b>Wallet:</b> <code>${walletAddress}</code>\n` +
        `• <b>Action:</b> ${actionText}\n` +
        `• <b>Protocol:</b> ${tx.protocol || 'Unknown'}\n` +
        `• <b>Amount In:</b> ${tx.asset_in_amount ? `${tx.asset_in_amount} ${tx.asset_in_symbol}` : 'None'}\n` +
        `• <b>Amount Out:</b> ${tx.asset_out_amount ? `${tx.asset_out_amount} ${tx.asset_out_symbol}` : 'None'}\n` +
        `• <b>Value USD:</b> $${valueUsd.toFixed(2)}\n` +
        `• <b>Tx Hash:</b> <a href="https://explorer.movementnetwork.xyz/txn/${tx.hash}?network=mainnet">${txHashTruncated}</a>`;

      if (config.email_enabled && config.email) {
        const htmlContent = `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #D4AF37;">🚨 Daftar Alert: Transaction Detected</h2>
            <p>A new transaction has been detected on your wallet.</p>
            <hr style="border: 0; border-top: 1px solid #eee;" />
            <table style="width: 100%;">
              <tr><td><b>Wallet:</b></td><td><code>${walletAddress}</code></td></tr>
              <tr><td><b>Action:</b></td><td>${actionText}</td></tr>
              <tr><td><b>Protocol:</b></td><td>${tx.protocol || 'Unknown'}</td></tr>
              <tr><td><b>Amount In:</b></td><td>${tx.asset_in_amount ? `${tx.asset_in_amount} ${tx.asset_in_symbol}` : 'None'}</td></tr>
              <tr><td><b>Amount Out:</b></td><td>${tx.asset_out_amount ? `${tx.asset_out_amount} ${tx.asset_out_symbol}` : 'None'}</td></tr>
              <tr><td><b>Value USD:</b></td><td>$${valueUsd.toFixed(2)}</td></tr>
              <tr><td><b>Tx Hash:</b></td><td><a href="https://explorer.movementnetwork.xyz/txn/${tx.hash}?network=mainnet">${txHashTruncated}</a></td></tr>
            </table>
            <hr style="border: 0; border-top: 1px solid #eee;" />
            <p style="font-size: 12px; color: #888;">Configure your settings on <a href="https://daftar.fi">Daftar.fi</a></p>
          </div>
        `;
        await sendEmailAlert(config.email, `🚨 Daftar Alert: ${actionText}`, htmlContent);
      }

      if (config.telegram_enabled && config.telegram_chat_id) {
        await sendTelegramAlert(config.telegram_chat_id, alertMessage);
      }

      if (config.discord_enabled && config.discord_user_id) {
        const fields = [
          { name: 'Wallet', value: `\`${walletAddress}\``, inline: false },
          { name: 'Protocol', value: tx.protocol || 'Unknown', inline: true },
          { name: 'Value', value: `$${valueUsd.toFixed(2)}`, inline: true },
          { name: 'Details', value: actionText, inline: false },
        ];
        await sendDiscordAlert(config.discord_user_id, '🚨 Transaction Detected', `A transaction matched your alert configuration.`, fields);
      }
    }
  } catch (err) {
    console.error(`[NotificationService] Error dispatching alerts for ${walletAddress}:`, err);
  }
}

export async function dispatchEventAlert(
  supabase: SupabaseClient,
  walletAddress: string,
  eventType: 'PROFILE_UPDATED' | 'PLAN_UPGRADED',
  metadata: any
) {
  try {
    const { data: config } = await supabase
      .from('user_alert_configs')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (!config) return;

    let title = '';
    let description = '';
    let fields: { name: string; value: string; inline?: boolean }[] = [];

    switch (eventType) {

      case 'PROFILE_UPDATED':
        title = '📝 Profile Updated';
        description = 'Your Daftar profile information has been successfully updated.';
        fields = [
          { name: 'Username', value: metadata.username || 'N/A', inline: true },
          { name: 'Wallet', value: `\`${walletAddress}\``, inline: false },
        ];
        break;
      case 'PLAN_UPGRADED':
        title = '🚀 Subscription Upgraded';
        description = `Welcome to **${metadata.tier || 'Premium'}**! Your new features are now active.`;
        fields = [
          { name: 'Wallet', value: `\`${walletAddress}\``, inline: false },
        ];
        break;
    }

    if (config.discord_enabled && config.discord_user_id) {
      await sendDiscordAlert(config.discord_user_id, title, description, fields);
    }
    
    if (config.telegram_enabled && config.telegram_chat_id) {
       const text = `<b>${title}</b>\n${description}`;
       await sendTelegramAlert(config.telegram_chat_id, text);
    }

  } catch (err) {
    console.error(`[NotificationService] Error dispatching event alert for ${walletAddress}:`, err);
  }
}
