import { Telegraf } from 'telegraf';
import { getSupabase } from '../../config/supabase.ts';
import { normalizeAddress } from '../../utils/address.ts';
import { getEffectiveTier } from '../../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';
import { fetchUserDeFiPositions } from '../../services/defiService.ts';
import fetch from 'node-fetch';
import CONFIG from '../../config/index.ts';

let bot: Telegraf | null = null;

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 2000; // 2 seconds cooldown per chat

function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const lastCall = rateLimitMap.get(chatId);
  if (lastCall && now - lastCall < RATE_LIMIT_MS) return true;
  rateLimitMap.set(chatId, now);
  return false;
}

// Periodic cleanup of stale rate limit entries (every 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [key, ts] of rateLimitMap) {
    if (ts < cutoff) rateLimitMap.delete(key);
  }
}, 300000);

// ─── Formatting Helpers ──────────────────────────────────────────────────────
function fmtUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(2)}`;
}

function fmtAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (amount >= 1) return amount.toFixed(4);
  return amount.toFixed(6);
}

function truncateAddr(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function pnlEmoji(pnl: number): string {
  if (pnl > 0) return '📈';
  if (pnl < 0) return '📉';
  return '➡️';
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────
async function getLinkedWallet(chatId: string): Promise<{ wallet: string; config: any } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_alert_configs')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (error || !data) return null;
  return { wallet: data.wallet_address, config: data };
}

async function requireLinkedWallet(ctx: any): Promise<{ wallet: string; config: any } | null> {
  const chatId = String(ctx.chat.id);
  const result = await getLinkedWallet(chatId);
  if (!result) {
    await ctx.reply(
      '❌ <b>No wallet linked</b>\n\n' +
      'Link your wallet first using:\n<code>/link [wallet_address]</code>\n\n' +
      'Or scan the QR code on <a href="https://daftar.fi/settings">Daftar Settings</a>.',
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
    return null;
  }
  return result;
}

async function requireProTier(ctx: any, wallet: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    await ctx.reply('⚠️ Service temporarily unavailable.');
    return false;
  }
  const tier = await getEffectiveTier(supabase, wallet);
  if (!isPremiumTier(tier)) {
    await ctx.reply(
      '🔒 <b>Pro Feature</b>\n\n' +
      'This command is exclusive to <b>Daftar Pro</b> subscribers.\n\n' +
      '👉 <a href="https://daftar.fi/plans">Upgrade to Pro</a>',
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
    return false;
  }
  return true;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export function getTelegramBot(): Telegraf | null {
  return bot;
}

export function initTelegramBot(): Telegraf | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN is not configured. Bot will not start.');
    return null;
  }

  const apiRoot = process.env.TELEGRAM_API_ROOT;
  console.log(`[TelegramBot] Initializing Telegraf bot${apiRoot ? ` with API root: ${apiRoot}` : ''}...`);
  bot = new Telegraf(token, apiRoot ? { telegram: { apiRoot } } : undefined);

  // ─── /start ──────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const startPayload = ctx.payload;
    const supabase = getSupabase();

    if (!supabase) {
      return ctx.reply('⚠️ Service temporarily unavailable. Please try again later.');
    }

    // Deep-link: t.me/DaftarFi_bot?start=0x...
    if (startPayload && startPayload.toLowerCase().startsWith('0x')) {
      const wallet = normalizeAddress(startPayload);
      if (!wallet) {
        return ctx.reply('⚠️ Invalid wallet address provided in link.');
      }
      return await performLinkWallet(ctx, supabase, wallet, chatId);
    }

    await ctx.reply(
      '👋 <b>Welcome to the Daftar Bot!</b>\n\n' +
      '🏦 Your all-in-one Movement Network portfolio companion.\n\n' +
      '<b>Get Started:</b>\n' +
      '• Link your wallet: <code>/link [address]</code>\n' +
      '• Or scan the QR code on <a href="https://daftar.fi/settings">Daftar Settings</a>\n\n' +
      '<b>Free Commands:</b>\n' +
      '• /price — Live token prices\n' +
      '• /network — Movement chain stats\n\n' +
      '<b>Pro Commands:</b> (requires <a href="https://daftar.fi/plans">Pro subscription</a>)\n' +
      '• /portfolio — Full net worth breakdown\n' +
      '• /balance — Token holdings & values\n' +
      '• /defi — DeFi lending & staking positions\n' +
      '• /transactions — Recent transaction history\n' +
      '• /alerts — Alert configuration overview\n' +
      '• /profile — Your Daftar profile & XP\n\n' +
      'Type /help anytime to see all commands.',
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
  });

  // ─── /link ───────────────────────────────────────────────────────────────
  bot.command('link', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    const walletArg = parts[1];
    const supabase = getSupabase();

    if (!supabase) {
      return ctx.reply('⚠️ Service temporarily unavailable.');
    }

    if (!walletArg || !walletArg.startsWith('0x')) {
      return ctx.reply(
        '⚠️ <b>Usage:</b> <code>/link [wallet_address]</code>\n\n' +
        'Example: <code>/link 0x1a2b3c...</code>',
        { parse_mode: 'HTML' }
      );
    }

    const wallet = normalizeAddress(walletArg);
    if (!wallet) {
      return ctx.reply('⚠️ Invalid wallet address format.');
    }

    await performLinkWallet(ctx, supabase, wallet, chatId);
  });

  // ─── /unlink ─────────────────────────────────────────────────────────────
  bot.command('unlink', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    const linked = await getLinkedWallet(chatId);
    if (!linked) {
      return ctx.reply('ℹ️ No wallet is currently linked to this chat.');
    }

    try {
      const { error } = await supabase
        .from('user_alert_configs')
        .update({
          telegram_chat_id: null,
          telegram_enabled: false,
          updated_at: new Date().toISOString()
        })
        .eq('wallet_address', linked.wallet);

      if (error) throw error;

      await ctx.reply(
        '✅ <b>Wallet Unlinked</b>\n\n' +
        `Wallet <code>${truncateAddr(linked.wallet)}</code> has been disconnected from this chat.\n\n` +
        'You will no longer receive alert notifications here.\n' +
        'To reconnect, use <code>/link [wallet_address]</code>.',
        { parse_mode: 'HTML' }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Unlink error:', err);
      await ctx.reply('❌ Failed to unlink wallet. Please try again.');
    }
  });

  // ─── /portfolio ──────────────────────────────────────────────────────────
  bot.command('portfolio', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;
    if (!(await requireProTier(ctx, linked.wallet))) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      // Latest networth snapshot
      const { data: snapshot } = await supabase
        .from('user_networth_snapshots')
        .select('*')
        .eq('user_address', linked.wallet)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!snapshot) {
        return ctx.reply(
          `📊 <b>Portfolio for</b> <code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No balance data found yet. Please wait for the indexer to sync your wallet.\n\n' +
          `<a href="https://daftar.fi/profile/${linked.wallet}">View on Daftar →</a>`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
      }

      const total = Number(snapshot.total_networth_usd || 0);
      const walletUsd = Number(snapshot.wallet_usd || 0);
      const defiUsd = Number(snapshot.defi_usd || 0);
      const nftUsd = Number(snapshot.nft_usd || 0);
      const netDeposits = Number(snapshot.net_deposits_usd || 0);

      // PnL calculation
      const pnl = netDeposits !== 0 ? total - netDeposits : 0;
      const pnlPct = netDeposits > 0 ? ((pnl / netDeposits) * 100) : 0;
      const pnlSign = pnl >= 0 ? '+' : '';

      // Previous snapshot for 24h change
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: prevSnapshot } = await supabase
        .from('user_networth_snapshots')
        .select('total_networth_usd')
        .eq('user_address', linked.wallet)
        .lte('timestamp', oneDayAgo)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      let change24h = '';
      if (prevSnapshot) {
        const prevTotal = Number(prevSnapshot.total_networth_usd || 0);
        if (prevTotal > 0) {
          const diff = total - prevTotal;
          const diffPct = (diff / prevTotal) * 100;
          const sign = diff >= 0 ? '+' : '';
          change24h = `\n• <b>24h Change:</b> ${sign}${fmtUsd(diff)} (${sign}${diffPct.toFixed(2)}%) ${pnlEmoji(diff)}`;
        }
      }

      await ctx.reply(
        `📊 <b>Portfolio Overview</b>\n` +
        `<code>${linked.wallet}</code>\n\n` +
        `💰 <b>Total Net Worth:</b> ${fmtUsd(total)}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `• <b>Wallet Tokens:</b> ${fmtUsd(walletUsd)}\n` +
        `• <b>DeFi Positions:</b> ${fmtUsd(defiUsd)}\n` +
        `• <b>NFT Holdings:</b> ${fmtUsd(nftUsd)}` +
        change24h + '\n' +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${pnlEmoji(pnl)} <b>All-Time PnL:</b> ${pnlSign}${fmtUsd(pnl)} (${pnlSign}${pnlPct.toFixed(2)}%)\n` +
        `💸 <b>Net Deposits:</b> ${fmtUsd(netDeposits)}\n\n` +
        `<a href="https://daftar.fi/profile/${linked.wallet}">View full analytics on Daftar →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Portfolio error:', err);
      await ctx.reply('❌ Failed to fetch portfolio data. Please try again.');
    }
  });

  // ─── /balance ────────────────────────────────────────────────────────────
  bot.command('balance', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;
    if (!(await requireProTier(ctx, linked.wallet))) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      // Get the latest snapshot date
      const { data: latestRow } = await supabase
        .from('user_balance_snapshots')
        .select('snapshot_date')
        .eq('user_address', linked.wallet)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestRow) {
        return ctx.reply(
          `👛 <b>Token Balances</b>\n<code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No balance data found. The indexer may still be syncing your wallet.',
          { parse_mode: 'HTML' }
        );
      }

      // Fetch all balances for that date
      const { data: balances } = await supabase
        .from('user_balance_snapshots')
        .select('asset_type, symbol, amount')
        .eq('user_address', linked.wallet)
        .eq('snapshot_date', latestRow.snapshot_date)
        .order('amount', { ascending: false });

      // Fetch live prices
      const { data: prices } = await supabase
        .from('price_cache')
        .select('token_id, price_usd');

      const priceMap: Record<string, number> = {};
      if (prices) {
        prices.forEach(p => {
          priceMap[p.token_id] = Number(p.price_usd);
          const short = p.token_id.toLowerCase().replace(/^0x0*/, '0x');
          if (!priceMap[short]) priceMap[short] = Number(p.price_usd);
        });
      }

      if (!balances || balances.length === 0) {
        return ctx.reply(
          `👛 <b>Token Balances</b>\n<code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No token holdings found.',
          { parse_mode: 'HTML' }
        );
      }

      // Build token lines with USD value
      type TokenLine = { symbol: string; amount: number; usd: number };
      const lines: TokenLine[] = [];
      let totalUsd = 0;

      for (const b of balances) {
        const amount = Number(b.amount);
        if (amount < 0.000001) continue;

        const short = b.asset_type.toLowerCase().replace(/^0x0*/, '0x');
        const price = priceMap[b.asset_type] || priceMap[short] || priceMap['0x1'] || 0;
        const usd = amount * price;
        totalUsd += usd;
        lines.push({ symbol: b.symbol || 'Unknown', amount, usd });
      }

      // Sort by USD value descending
      lines.sort((a, b) => b.usd - a.usd);

      // Format — show top 15 tokens
      const displayLines = lines.slice(0, 15).map((t, i) => {
        const rank = i + 1;
        return `${rank}. <b>${t.symbol}</b> — ${fmtAmount(t.amount)} (${fmtUsd(t.usd)})`;
      });

      const moreCount = lines.length - 15;
      const moreText = moreCount > 0 ? `\n<i>+ ${moreCount} more tokens</i>` : '';

      await ctx.reply(
        `👛 <b>Token Balances</b>\n` +
        `<code>${truncateAddr(linked.wallet)}</code>\n` +
        `<i>As of ${latestRow.snapshot_date}</i>\n\n` +
        displayLines.join('\n') +
        moreText +
        `\n\n💰 <b>Total Wallet Value:</b> ${fmtUsd(totalUsd)}\n\n` +
        `<a href="https://daftar.fi/profile/${linked.wallet}">View on Daftar →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Balance error:', err);
      await ctx.reply('❌ Failed to fetch token balances. Please try again.');
    }
  });

  // ─── /defi ───────────────────────────────────────────────────────────────
  bot.command('defi', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;
    if (!(await requireProTier(ctx, linked.wallet))) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      await ctx.reply('🔍 Scanning DeFi protocols… This may take a moment.');

      // Fetch live prices
      const { data: prices } = await supabase
        .from('price_cache')
        .select('token_id, price_usd');

      const priceMap: Record<string, number> = {};
      if (prices) {
        prices.forEach(p => priceMap[p.token_id] = Number(p.price_usd));
      }

      const positions = await fetchUserDeFiPositions(supabase, linked.wallet, priceMap);

      if (positions.length === 0) {
        return ctx.reply(
          `🏦 <b>DeFi Positions</b>\n<code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No active DeFi positions detected.\n\n' +
          '<i>Supported protocols: Echelon, Canopy, Joule, Meridian</i>',
          { parse_mode: 'HTML' }
        );
      }

      let totalDefi = 0;
      const lines: string[] = [];

      // Group by protocol
      const byProtocol: Record<string, typeof positions> = {};
      for (const p of positions) {
        if (!byProtocol[p.protocol]) byProtocol[p.protocol] = [];
        byProtocol[p.protocol].push(p);
        totalDefi += p.usdValue;
      }

      for (const [protocol, pList] of Object.entries(byProtocol)) {
        lines.push(`\n<b>🔹 ${protocol}</b>`);
        for (const p of pList) {
          const typeEmoji = p.type === 'Debt' ? '🔴' : p.type === 'Staking' ? '🟢' : '🔵';
          lines.push(`  ${typeEmoji} ${p.type}: ${fmtAmount(p.amount)} ${p.symbol} (${fmtUsd(p.usdValue)})`);
        }
      }

      await ctx.reply(
        `🏦 <b>DeFi Positions</b>\n` +
        `<code>${truncateAddr(linked.wallet)}</code>\n` +
        lines.join('\n') +
        `\n\n━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Total DeFi Value:</b> ${fmtUsd(totalDefi)}\n\n` +
        `<a href="https://daftar.fi/profile/${linked.wallet}">View on Daftar →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] DeFi error:', err);
      await ctx.reply('❌ Failed to scan DeFi positions. Please try again.');
    }
  });

  // ─── /transactions ───────────────────────────────────────────────────────
  bot.command('transactions', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;
    if (!(await requireProTier(ctx, linked.wallet))) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      const { data: txs, error } = await supabase
        .from('user_transaction_history')
        .select('hash, timestamp, action, protocol, description, asset_in_symbol, asset_in_amount, asset_out_symbol, asset_out_amount, value_usd')
        .eq('user_address', linked.wallet)
        .order('timestamp', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!txs || txs.length === 0) {
        return ctx.reply(
          `📜 <b>Recent Transactions</b>\n<code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No transactions found yet.',
          { parse_mode: 'HTML' }
        );
      }

      const lines = txs.map((tx, i) => {
        const date = new Date(tx.timestamp);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const action = tx.action || 'TX';
        const protocol = tx.protocol ? ` on ${tx.protocol}` : '';
        const valueStr = tx.value_usd ? ` • ${fmtUsd(Number(tx.value_usd))}` : '';
        const hashLink = tx.hash ? `<a href="https://explorer.movementnetwork.xyz/txn/${tx.hash}?network=mainnet">${truncateAddr(tx.hash)}</a>` : '';

        let detail = '';
        if (tx.asset_in_amount && tx.asset_in_symbol) {
          detail += `${fmtAmount(Number(tx.asset_in_amount))} ${tx.asset_in_symbol}`;
        }
        if (tx.asset_out_amount && tx.asset_out_symbol) {
          if (detail) detail += ' → ';
          detail += `${fmtAmount(Number(tx.asset_out_amount))} ${tx.asset_out_symbol}`;
        }
        const detailStr = detail ? `\n    ${detail}` : '';

        return `${i + 1}. <b>${action}</b>${protocol}${valueStr}\n    ${dateStr} • ${hashLink}${detailStr}`;
      });

      await ctx.reply(
        `📜 <b>Recent Transactions</b>\n` +
        `<code>${truncateAddr(linked.wallet)}</code>\n\n` +
        lines.join('\n\n') +
        `\n\n<a href="https://daftar.fi/profile/${linked.wallet}">View all on Daftar →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Transactions error:', err);
      await ctx.reply('❌ Failed to fetch transactions. Please try again.');
    }
  });

  // ─── /price ──────────────────────────────────────────────────────────────
  bot.command('price', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      const tokenIds = [
        '0x1',  // MOVE
        '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',  // BTC
        '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',  // ETH
      ];

      const { data: prices, error } = await supabase
        .from('price_cache')
        .select('token_id, price_usd, change_24h, cached_at')
        .in('token_id', tokenIds);

      if (error) throw error;

      const priceMap: Record<string, { price: number; change: number; cachedAt: string }> = {};
      if (prices) {
        prices.forEach(p => {
          priceMap[p.token_id] = {
            price: Number(p.price_usd),
            change: Number(p.change_24h || 0),
            cachedAt: p.cached_at
          };
        });
      }

      const move = priceMap['0x1'];
      const btc = priceMap['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'];
      const eth = priceMap['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'];

      const formatLine = (symbol: string, data: typeof move | undefined) => {
        if (!data) return `• <b>${symbol}:</b> Price unavailable`;
        const sign = data.change >= 0 ? '+' : '';
        const emoji = data.change >= 0 ? '🟢' : '🔴';
        return `${emoji} <b>${symbol}:</b> $${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: symbol === 'MOVE' ? 5 : 2 })} (${sign}${data.change.toFixed(2)}%)`;
      };

      const lastUpdated = move?.cachedAt
        ? new Date(move.cachedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
        : 'Unknown';

      await ctx.reply(
        `💹 <b>Live Token Prices</b>\n\n` +
        formatLine('MOVE', move) + '\n' +
        formatLine('BTC', btc) + '\n' +
        formatLine('ETH', eth) + '\n\n' +
        `<i>Last updated: ${lastUpdated}</i>\n` +
        '<i>Source: CoinGecko</i>',
        { parse_mode: 'HTML' }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Price error:', err);
      await ctx.reply('❌ Failed to fetch prices. Please try again.');
    }
  });

  // ─── /alerts ─────────────────────────────────────────────────────────────
  bot.command('alerts', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;

    const c = linked.config;

    const channelStatus = (enabled: boolean, linked: boolean) => {
      if (linked && enabled) return '✅ Active';
      if (linked && !enabled) return '⏸ Linked (Paused)';
      return '❌ Not connected';
    };

    const rules = [
      c.alert_on_received ? '✅ Incoming funds' : '❌ Incoming funds',
      c.alert_on_withdrawal ? '✅ Outgoing funds' : '❌ Outgoing funds',
      c.alert_on_swaps ? '✅ Swap actions' : '❌ Swap actions',
      c.alert_on_failed ? '✅ Failed transactions' : '❌ Failed transactions',
    ];

    await ctx.reply(
      `🔔 <b>Alert Configuration</b>\n` +
      `<code>${truncateAddr(linked.wallet)}</code>\n\n` +
      `<b>Channels:</b>\n` +
      `• 📧 Email: ${channelStatus(c.email_enabled, !!c.email)}\n` +
      `• 📱 Telegram: ${channelStatus(c.telegram_enabled, !!c.telegram_chat_id)}\n` +
      `• 💬 Discord: ${channelStatus(c.discord_enabled, !!c.discord_user_id)}\n\n` +
      `<b>Filters:</b>\n` +
      `• 💵 Min. value: $${Number(c.min_amount_usd || 0).toFixed(2)}\n\n` +
      `<b>Alert Rules:</b>\n` +
      rules.join('\n') + '\n\n' +
      `<a href="https://daftar.fi/settings">Manage on Daftar Settings →</a>`,
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
  });

  // ─── /profile ────────────────────────────────────────────────────────────
  bot.command('profile', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    const linked = await requireLinkedWallet(ctx);
    if (!linked) return;

    const supabase = getSupabase();
    if (!supabase) return ctx.reply('⚠️ Service temporarily unavailable.');

    try {
      // Fetch profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, bio, xp, is_verified, subscription_tier, subscription_expires_at, twitter, telegram')
        .eq('wallet_address', linked.wallet)
        .maybeSingle();

      // Fetch badge count
      const { count: badgeCount } = await supabase
        .from('badge_attestations')
        .select('id', { count: 'exact', head: true })
        .eq('wallet_address', linked.wallet)
        .eq('eligible', true);

      if (!profile) {
        return ctx.reply(
          `👤 <b>Profile</b>\n<code>${truncateAddr(linked.wallet)}</code>\n\n` +
          'No Daftar profile found for this wallet.\n\n' +
          `<a href="https://daftar.fi/profile/${linked.wallet}">Create your profile →</a>`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
      }

      const tier = profile.subscription_tier || 'free';
      const tierEmoji = tier === 'pro' || tier === 'lite' ? '⭐' : '🆓';
      const verifiedBadge = profile.is_verified ? ' ✅' : '';
      const displayName = profile.username || truncateAddr(linked.wallet);
      const bio = profile.bio ? `\n<i>"${profile.bio}"</i>` : '';

      let expiryLine = '';
      if (profile.subscription_expires_at) {
        const expiry = new Date(profile.subscription_expires_at);
        const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          expiryLine = `\n• ⏰ <b>Expires:</b> ${expiry.toLocaleDateString()} (${daysLeft} days left)`;
        } else {
          expiryLine = '\n• ⏰ <b>Status:</b> Expired';
        }
      }

      const socials: string[] = [];
      if (profile.twitter) socials.push(`🐦 <a href="https://twitter.com/${profile.twitter}">@${profile.twitter}</a>`);
      if (profile.telegram) socials.push(`📱 @${profile.telegram}`);
      const socialsLine = socials.length > 0 ? '\n' + socials.join(' • ') : '';

      await ctx.reply(
        `👤 <b>${displayName}</b>${verifiedBadge}${bio}\n` +
        `<code>${linked.wallet}</code>\n\n` +
        `• ${tierEmoji} <b>Tier:</b> ${tier.charAt(0).toUpperCase() + tier.slice(1)}${expiryLine}\n` +
        `• ⚡ <b>XP:</b> ${Number(profile.xp || 0).toLocaleString()}\n` +
        `• 🏅 <b>Badges:</b> ${badgeCount || 0} earned` +
        socialsLine + '\n\n' +
        `<a href="https://daftar.fi/profile/${linked.wallet}">View full profile →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Profile error:', err);
      await ctx.reply('❌ Failed to fetch profile. Please try again.');
    }
  });

  // ─── /network ────────────────────────────────────────────────────────────
  bot.command('network', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    try {
      // Query Movement mainnet RPC for ledger info
      const rpcUrl = CONFIG.MOVEMENT.RPC_URL;
      const response = await fetch(rpcUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error(`RPC returned ${response.status}`);

      const data: any = await response.json();

      const blockHeight = Number(data.block_height || 0).toLocaleString();
      const epoch = data.epoch || 'N/A';
      const ledgerVersion = Number(data.ledger_version || 0).toLocaleString();
      const oldestVersion = Number(data.oldest_ledger_version || 0).toLocaleString();
      const ledgerTs = data.ledger_timestamp
        ? new Date(Number(data.ledger_timestamp) / 1000).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC'
        }) + ' UTC'
        : 'N/A';

      // Fetch MOVE price for context
      const supabase = getSupabase();
      let movePrice = '';
      if (supabase) {
        const { data: pricePull } = await supabase
          .from('price_cache')
          .select('price_usd')
          .eq('token_id', '0x1')
          .maybeSingle();
        if (pricePull) {
          movePrice = `\n• 💰 <b>MOVE Price:</b> $${Number(pricePull.price_usd).toFixed(5)}`;
        }
      }

      await ctx.reply(
        `🌐 <b>Movement Network Status</b>\n\n` +
        `• 📦 <b>Block Height:</b> ${blockHeight}\n` +
        `• 🔄 <b>Epoch:</b> ${epoch}\n` +
        `• 📝 <b>Ledger Version:</b> ${ledgerVersion}\n` +
        `• 🕐 <b>Ledger Time:</b> ${ledgerTs}\n` +
        `• 📜 <b>Oldest Version:</b> ${oldestVersion}` +
        movePrice + '\n\n' +
        `<i>Network: Movement Mainnet</i>\n` +
        `<a href="https://explorer.movementnetwork.xyz">View Explorer →</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } catch (err: any) {
      console.error('[TelegramBot] Network error:', err);
      await ctx.reply('❌ Failed to fetch network status. The RPC may be temporarily unreachable.');
    }
  });

  // ─── /help ───────────────────────────────────────────────────────────────
  bot.help((ctx) => {
    const chatId = String(ctx.chat.id);
    if (isRateLimited(chatId)) return;

    ctx.reply(
      '💡 <b>Daftar Bot — Command Reference</b>\n\n' +
      '<b>🔗 Wallet Management</b>\n' +
      '• <code>/link [address]</code> — Link your Movement wallet\n' +
      '• <code>/unlink</code> — Disconnect your wallet\n\n' +
      '<b>📊 Portfolio (Pro)</b>\n' +
      '• <code>/portfolio</code> — Net worth overview & PnL\n' +
      '• <code>/balance</code> — Token holdings & values\n' +
      '• <code>/defi</code> — DeFi lending & staking positions\n' +
      '• <code>/transactions</code> — Recent activity (last 10)\n\n' +
      '<b>🔔 Alerts (Pro)</b>\n' +
      '• <code>/alerts</code> — View alert configuration\n\n' +
      '<b>👤 Profile (Pro)</b>\n' +
      '• <code>/profile</code> — XP, badges & account info\n\n' +
      '<b>🌐 Network (Free)</b>\n' +
      '• <code>/price</code> — Live MOVE, BTC, ETH prices\n' +
      '• <code>/network</code> — Movement chain stats\n\n' +
      '<i>Pro commands require a Daftar Pro subscription.</i>\n' +
      '👉 <a href="https://daftar.fi/plans">View Plans</a> • <a href="https://daftar.fi/settings">Settings</a>',
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
  });

  // ─── Fallback: Unknown Commands ──────────────────────────────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      const chatId = String(ctx.chat.id);
      if (isRateLimited(chatId)) return;

      await ctx.reply(
        `❓ Unknown command: <code>${text.split(' ')[0]}</code>\n\n` +
        'Type /help to see available commands.',
        { parse_mode: 'HTML' }
      );
    }
  });

  // ─── Launch Bot ──────────────────────────────────────────────────────────
  bot.launch()
    .then(() => {
      console.log('[TelegramBot] 🤖 Daftar Bot started successfully.');
    })
    .catch((err) => {
      console.error('[TelegramBot] Failed to launch:', err);
      bot = null;
    });

  // Graceful shutdown
  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));

  return bot;
}

// ─── Link Wallet Helper ──────────────────────────────────────────────────────
async function performLinkWallet(ctx: any, supabase: any, wallet: string, chatId: string) {
  try {
    // Verify subscription tier
    const tier = await getEffectiveTier(supabase, wallet);
    if (!isPremiumTier(tier)) {
      return ctx.reply(
        '🔒 <b>Pro Subscription Required</b>\n\n' +
        'Telegram bot features are exclusive to <b>Daftar Pro</b> subscribers.\n\n' +
        'Upgrade your plan to unlock:\n' +
        '• Real-time transaction alerts\n' +
        '• Portfolio & balance checking\n' +
        '• DeFi position scanning\n' +
        '• Transaction history\n\n' +
        '👉 <a href="https://daftar.fi/plans">View Subscription Plans</a>',
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    }

    // Check if another chat is already linked to this wallet
    const { data: existingLink } = await supabase
      .from('user_alert_configs')
      .select('telegram_chat_id')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (existingLink && existingLink.telegram_chat_id && existingLink.telegram_chat_id !== chatId) {
      // Overwrite — only one Telegram chat per wallet
      console.log(`[TelegramBot] Reassigning wallet ${wallet} from chat ${existingLink.telegram_chat_id} to ${chatId}`);
    }

    // Upsert the link
    const { error } = await supabase
      .from('user_alert_configs')
      .upsert({
        wallet_address: wallet,
        telegram_chat_id: chatId,
        telegram_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' });

    if (error) throw error;

    // Fetch profile for welcome context
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, xp')
      .eq('wallet_address', wallet)
      .maybeSingle();

    const displayName = profile?.username ? `, <b>${profile.username}</b>` : '';
    const xpLine = profile?.xp ? `\n⚡ XP: ${Number(profile.xp).toLocaleString()}` : '';

    await ctx.reply(
      `✅ <b>Wallet Linked Successfully!</b>\n\n` +
      `Welcome${displayName}! 🎉\n\n` +
      `Your Telegram is now paired with:\n` +
      `<code>${wallet}</code>${xpLine}\n\n` +
      `<b>You can now use:</b>\n` +
      `• /portfolio — View net worth\n` +
      `• /balance — Token holdings\n` +
      `• /transactions — Recent activity\n` +
      `• /alerts — Alert status\n\n` +
      `Configure alerts on <a href="https://daftar.fi/settings">Daftar Settings</a>.`,
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
  } catch (err: any) {
    console.error('[TelegramBot] Link error:', err);
    await ctx.reply('❌ Failed to link your wallet. Please verify your address and try again.');
  }
}
