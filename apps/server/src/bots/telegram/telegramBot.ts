import { Telegraf } from 'telegraf';
import { getSupabase } from '../../config/supabase.ts';
import { normalizeAddress } from '../../utils/address.ts';
import { getEffectiveTier } from '../../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';

let bot: Telegraf | null = null;

export function getTelegramBot(): Telegraf | null {
  return bot;
}

export function initTelegramBot(): Telegraf | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN is not configured in .env. Telegram bot will not start.');
    return null;
  }

  bot = new Telegraf(token);

  // Command /start (supporting deep linking start parameters e.g. t.me/bot?start=0x...)
  bot.start(async (ctx) => {
    const startPayload = ctx.payload; // Extract payload from t.me/bot?start=payload
    const chatId = String(ctx.chat.id);
    const supabase = getSupabase();

    if (!supabase) {
      return ctx.reply('⚠️ Service temporarily unavailable. Please try again later.');
    }

    if (startPayload && startPayload.toLowerCase().startsWith('0x')) {
      const wallet = normalizeAddress(startPayload);
      if (!wallet) {
        return ctx.reply('⚠️ Invalid wallet address provided in link.');
      }
      return await performLinkWallet(ctx, supabase, wallet, chatId);
    }

    ctx.reply(
      '👋 <b>Welcome to Daftar Alert Bot!</b>\n\n' +
      'To receive real-time notifications about your portfolio transactions, link your wallet address using:\n' +
      '<code>/link [wallet_address]</code>\n\n' +
      '<i>Note: Alert notifications are exclusive to Daftar Pro subscribers.</i>',
      { parse_mode: 'HTML' }
    );
  });

  // Command /link <wallet>
  bot.command('link', async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    const walletArg = parts[1];
    const chatId = String(ctx.chat.id);
    const supabase = getSupabase();

    if (!supabase) {
      return ctx.reply('⚠️ Service temporarily unavailable. Please try again later.');
    }

    if (!walletArg || !walletArg.startsWith('0x')) {
      return ctx.reply('⚠️ Usage: <code>/link [wallet_address]</code>', { parse_mode: 'HTML' });
    }

    const wallet = normalizeAddress(walletArg);
    if (!wallet) {
      return ctx.reply('⚠️ Invalid wallet address format.');
    }

    await performLinkWallet(ctx, supabase, wallet, chatId);
  });

  // Command /portfolio
  bot.command('portfolio', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const supabase = getSupabase();

    if (!supabase) {
      return ctx.reply('⚠️ Service temporarily unavailable.');
    }

    try {
      // Find wallet associated with this chatId
      const { data: config, error } = await supabase
        .from('user_alert_configs')
        .select('wallet_address')
        .eq('telegram_chat_id', chatId)
        .maybeSingle();

      if (error) throw error;
      if (!config) {
        return ctx.reply('❌ You have not linked a wallet yet. Use <code>/link [wallet_address]</code> to connect.', { parse_mode: 'HTML' });
      }

      const wallet = config.wallet_address;
      
      // Fetch latest net worth snapshot
      const { data: snapshot } = await supabase
        .from('user_networth_snapshots')
        .select('*')
        .eq('user_address', wallet)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!snapshot) {
        return ctx.reply(`📊 <b>Portfolio for</b> <code>${wallet}</code>\n\nNo balance snapshots found yet. Please wait for the system indexer to sync your profile.`, { parse_mode: 'HTML' });
      }

      const total = Number(snapshot.total_networth_usd || 0);
      const walletBalance = Number(snapshot.wallet_usd || 0);
      const defiBalance = Number(snapshot.defi_usd || 0);
      const nftBalance = Number(snapshot.nft_usd || 0);

      ctx.reply(
        `📊 <b>Portfolio for</b> <code>${wallet}</code>\n\n` +
        `• <b>Total Net Worth:</b> $${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD\n` +
        `• <b>Wallet Assets:</b> $${walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD\n` +
        `• <b>DeFi Positions:</b> $${defiBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD\n` +
        `• <b>NFT Holdings:</b> $${nftBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD\n\n` +
        `<a href="https://daftar.fi/profile/${wallet}">View full profile details on website</a>`,
        { parse_mode: 'HTML' }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Portfolio fetch error:', err);
      ctx.reply('❌ Failed to fetch portfolio data.');
    }
  });

  bot.help((ctx) => {
    ctx.reply(
      '💡 <b>Available Commands:</b>\n\n' +
      '• <code>/link [wallet_address]</code> - Link your wallet to receive transaction notifications.\n' +
      '• <code>/portfolio</code> - Check your linked wallet\'s net worth and assets.\n' +
      '• <code>/help</code> - Show this list of commands.',
      { parse_mode: 'HTML' }
    );
  });

  // Run the Bot in the background
  bot.launch()
    .then(() => {
      console.log('[TelegramBot] 🤖 Telegram Alert Bot started successfully.');
    })
    .catch((err) => {
      console.error('[TelegramBot] Failed to launch Telegram Bot:', err);
    });

  // Enable graceful stop
  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));

  return bot;
}

/**
 * Helper to perform linking check & DB update
 */
async function performLinkWallet(ctx: any, supabase: any, wallet: string, chatId: string) {
  try {
    // 1. Verify user subscription tier
    const tier = await getEffectiveTier(supabase, wallet);
    if (!isPremiumTier(tier)) {
      return ctx.reply(
        '❌ <b>Access Denied</b>\n\n' +
        'Telegram notifications are a <b>Pro / Premium</b> exclusive feature. ' +
        'Please upgrade your subscription to unlock notifications.\n\n' +
        '👉 <a href="https://daftar.fi/plans">View Subscription Plans</a>',
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
    }

    // 2. Link wallet address to telegram chat ID
    const { error } = await supabase
      .from('user_alert_configs')
      .upsert({
        wallet_address: wallet,
        telegram_chat_id: chatId,
        telegram_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' });

    if (error) throw error;

    ctx.reply(
      `✅ <b>Wallet Linked Successfully!</b>\n\n` +
      `Your Telegram account is now paired with:\n<code>${wallet}</code>\n\n` +
      `You will receive alerts here for transactions matching your preferences. You can adjust filters on <a href="https://daftar.fi/settings">Daftar Settings</a>.`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  } catch (err: any) {
    console.error('[TelegramBot] Link error:', err);
    ctx.reply('❌ Failed to link your wallet. Please verify your settings and try again.');
  }
}
