import { SupabaseClient } from '@supabase/supabase-js';
import { PriceSnapshot, TOKEN_COINGECKO_IDS } from './priceService.ts';
import { sendDiscordAlert, sendTelegramAlert } from './notificationService.ts';

const COOLDOWN_HOURS = 6;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

export async function processPriceAlerts(supabase: SupabaseClient, snapshot: PriceSnapshot) {
  try {
    // 1. Fetch all users who have price alerts enabled
    const { data: configs, error } = await supabase
      .from('user_alert_configs')
      .select('*')
      .eq('alert_on_price_change', true);

    if (error || !configs || configs.length === 0) return;

    // Tokens we track for alerts
    const alertTokens = ['0x1', '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c', '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'];

    for (const tokenAddr of alertTokens) {
      const price = snapshot.prices[tokenAddr];
      const change24h = snapshot.priceChanges[tokenAddr];
      
      if (!price || change24h === undefined) continue;

      const symbol = tokenAddr === '0x1' ? 'MOVE' : (tokenAddr === '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c' ? 'BTC' : 'ETH');
      const absChange = Math.abs(change24h);

      for (const config of configs) {
        const threshold = Number(config.price_alert_threshold || 5.0);

        if (absChange >= threshold) {
          // Check cooldown for this user + token
          const { data: logEntry } = await supabase
            .from('price_alerts_log')
            .select('last_alert_sent_at')
            .eq('wallet_address', config.wallet_address)
            .eq('token_address', tokenAddr)
            .order('last_alert_sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let shouldAlert = true;
          if (logEntry) {
            const lastAlertTime = new Date(logEntry.last_alert_sent_at).getTime();
            if (Date.now() - lastAlertTime < COOLDOWN_MS) {
              shouldAlert = false;
            }
          }

          if (shouldAlert) {
            // Send Alert
            const sign = change24h >= 0 ? '+' : '';
            const emoji = change24h >= 0 ? '🚀' : '📉';
            const title = `${emoji} ${symbol} Price Alert: ${sign}${change24h.toFixed(2)}%`;
            const desc = `${symbol} has experienced a significant price movement in the last 24 hours.`;
            const fields = [
              { name: 'Current Price', value: `$${price.toLocaleString()}`, inline: true },
              { name: '24h Change', value: `${sign}${change24h.toFixed(2)}%`, inline: true },
              { name: 'Your Threshold', value: `±${threshold}%`, inline: true }
            ];

            let sent = false;

            if (config.discord_user_id) {
              await sendDiscordAlert(config.discord_user_id, title, desc, fields).catch(console.error);
              sent = true;
            }

            if (config.telegram_chat_id) {
              const text = `<b>${title}</b>\n\n${desc}\n\nPrice: $${price.toLocaleString()}\nChange: ${sign}${change24h.toFixed(2)}%\nThreshold: ±${threshold}%`;
              await sendTelegramAlert(config.telegram_chat_id, text).catch(console.error);
              sent = true;
            }

            // Log it
            if (sent) {
              const { error: insertErr } = await supabase.from('price_alerts_log').insert({
                wallet_address: config.wallet_address,
                token_address: tokenAddr,
                last_alert_sent_at: new Date().toISOString(),
                last_alert_price: price
              });
              if (insertErr) {
                console.error('[PriceAlertWorker] Failed to log alert:', insertErr);
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[PriceAlertWorker] Error processing price alerts:', err.message);
  }
}
