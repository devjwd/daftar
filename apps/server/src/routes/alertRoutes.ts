import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { normalizeAddress } from '../utils/address.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';
import { checkRateLimit, checkAndBurnNonce } from '../services/dbService.ts';
import { verifyWalletSignature } from '../utils/crypto.ts';
import { getEffectiveTier } from '../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';
import { sendEmailAlert, sendTelegramAlert, sendDiscordAlert } from '../services/notificationService.ts';
import fetch from 'node-fetch';

const router = express.Router();

// Masking Helper Functions
function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) {
    return `${name[0]}*@${domain}`;
  }
  return `${name.slice(0, 2)}${'*'.repeat(name.length - 3)}${name.slice(-1)}@${domain}`;
}

function maskId(id: string): string {
  const str = String(id);
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

/**
 * GET /api/alerts/config
 * Retrieves the current alert configuration for a wallet.
 * Supports both authenticated (unmasked) and unauthenticated (masked) fetches.
 */
router.get('/config', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const address = normalizeAddress(req.query.address as string);
  const signature = req.query.signature as string;
  const message = req.query.message as string;
  const nonce = req.query.nonce as string;

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  let isAuthenticated = false;
  if (signature && message && nonce) {
    // Nonce check
    const nonceCheck = await checkAndBurnNonce(supabaseAdmin, address, nonce);
    if (nonceCheck.ok) {
      // Verify signature
      const isValid = verifyWalletSignature(address, message, signature);
      if (isValid) {
        isAuthenticated = true;
      }
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .select('*')
      .eq('wallet_address', address)
      .maybeSingle();

    if (error) throw error;

    const config = data || {
      wallet_address: address,
      email: '',
      telegram_chat_id: '',
      discord_user_id: '',
      email_enabled: false,
      telegram_enabled: false,
      discord_enabled: false,
      min_amount_usd: 0,
      alert_on_received: true,
      alert_on_withdrawal: true,
      alert_on_swaps: false,
      alert_on_failed: false
    };

    if (!isAuthenticated) {
      // Mask sensitive fields
      if (config.email) {
        config.email = maskEmail(config.email);
      }
      if (config.telegram_chat_id) {
        config.telegram_chat_id = maskId(config.telegram_chat_id);
      }
      if (config.discord_user_id) {
        config.discord_user_id = maskId(config.discord_user_id);
      }
    }

    return res.status(200).json(config);
  } catch (err: any) {
    console.error('[AlertRoutes] Fetch config error:', err);
    return res.status(500).json({ error: 'Failed to fetch alert configuration' });
  }
});

/**
 * POST /api/alerts/config
 * Updates the alert configuration for a wallet
 * Authenticated via signature verification
 */
router.post('/config', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const {
    address,
    email,
    email_enabled,
    telegram_enabled,
    discord_enabled,
    min_amount_usd,
    alert_on_received,
    alert_on_withdrawal,
    alert_on_swaps,
    alert_on_failed,
    signature,
    signedMessage,
    nonce
  } = req.body;

  const normalizedAddr = normalizeAddress(address);
  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid address' });
  if (!signature || !signedMessage || !nonce) return res.status(401).json({ error: 'Signature and nonce are required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  // Check Subscription Tier (must be Premium/Pro to configure alerts)
  const tier = await getEffectiveTier(supabaseAdmin, normalizedAddr);
  if (!isPremiumTier(tier)) {
    return res.status(403).json({ error: 'Alerts are a Premium/Pro exclusive feature.' });
  }

  // Nonce check
  const nonceCheck = await checkAndBurnNonce(supabaseAdmin, normalizedAddr, nonce);
  if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });

  // Verify signature
  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    // Retrieve existing configuration to preserve actual values of masked fields
    const { data: existingConfig } = await supabaseAdmin
      .from('user_alert_configs')
      .select('email')
      .eq('wallet_address', normalizedAddr)
      .maybeSingle();

    let finalEmail = email;
    if (email && email.includes('*') && existingConfig?.email) {
      finalEmail = existingConfig.email;
    }

    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .upsert({
        wallet_address: normalizedAddr,
        email: finalEmail || null,
        email_enabled: !!email_enabled,
        telegram_enabled: !!telegram_enabled,
        discord_enabled: !!discord_enabled,
        min_amount_usd: Number(min_amount_usd || 0),
        alert_on_received: !!alert_on_received,
        alert_on_withdrawal: !!alert_on_withdrawal,
        alert_on_swaps: !!alert_on_swaps,
        alert_on_failed: !!alert_on_failed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err: any) {
    console.error('[AlertRoutes] Save config error:', err);
    return res.status(500).json({ error: 'Failed to save alert configuration' });
  }
});

/**
 * POST /api/alerts/link-discord
 * Links a Discord User ID to a wallet address.
 * Initiated from settings page click when user comes from Discord `/link` command.
 */
router.post('/link-discord', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const { address, discord_user_id, signature, signedMessage, nonce } = req.body;
  const normalizedAddr = normalizeAddress(address);

  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid address' });
  if (!discord_user_id) return res.status(400).json({ error: 'Invalid Discord User ID' });
  if (!signature || !signedMessage || !nonce) return res.status(401).json({ error: 'Signature and nonce are required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  // Check subscription tier
  const tier = await getEffectiveTier(supabaseAdmin, normalizedAddr);
  if (!isPremiumTier(tier)) {
    return res.status(403).json({ error: 'Alert integrations require a Pro / Premium tier.' });
  }

  // Nonce check
  const nonceCheck = await checkAndBurnNonce(supabaseAdmin, normalizedAddr, nonce);
  if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });

  // Verify signature
  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .upsert({
        wallet_address: normalizedAddr,
        discord_user_id: discord_user_id,
        discord_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ message: 'Discord account linked successfully!', config: data });
  } catch (err: any) {
    console.error('[AlertRoutes] Link Discord error:', err);
    return res.status(500).json({ error: 'Failed to link Discord account' });
  }
});

/**
 * POST /api/alerts/test
 * Triggers a mock/test notification on all active/enabled channels
 */
router.post('/test', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const { address, signature, signedMessage, nonce } = req.body;
  const normalizedAddr = normalizeAddress(address);

  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid address' });
  if (!signature || !signedMessage || !nonce) return res.status(401).json({ error: 'Signature and nonce are required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  // Nonce check
  const nonceCheck = await checkAndBurnNonce(supabaseAdmin, normalizedAddr, nonce);
  if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });

  // Verify signature
  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { data: config, error } = await supabaseAdmin
      .from('user_alert_configs')
      .select('*')
      .eq('wallet_address', normalizedAddr)
      .maybeSingle();

    if (error) throw error;
    if (!config) {
      return res.status(404).json({ error: 'Alert configuration not found for this wallet' });
    }

    const testSubject = '🚨 Daftar Alert: Test Notification';
    const testText = '<b>🚨 Daftar Alert: Test Notification Successful</b>\n\n' +
      'If you are reading this, your alert notification channel has been set up correctly! Future transaction warnings will be sent here.';

    let channelsTriggered: string[] = [];

    if (config.email_enabled && config.email) {
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #D4AF37;">🚨 Daftar Alert: Test Notification</h2>
          <p>Congratulations! Your email notification channel is set up and functional.</p>
          <hr style="border: 0; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #888;">Configure your preferences at <a href="https://daftar.fi">Daftar.fi</a></p>
        </div>
      `;
      await sendEmailAlert(config.email, testSubject, emailHtml);
      channelsTriggered.push('email');
    }

    if (config.telegram_enabled && config.telegram_chat_id) {
      await sendTelegramAlert(config.telegram_chat_id, testText);
      channelsTriggered.push('telegram');
    }

    if (config.discord_enabled && config.discord_user_id) {
      const fields = [
        { name: 'Channel Status', value: 'Functional ✅', inline: true },
        { name: 'Trigger Time', value: new Date().toLocaleTimeString(), inline: true }
      ];
      await sendDiscordAlert(config.discord_user_id, '🚨 Test Notification', 'Your Discord alert configurations are active.', fields);
      channelsTriggered.push('discord');
    }

    return res.status(200).json({ success: true, channelsTriggered });
  } catch (err: any) {
    console.error('[AlertRoutes] Test alert error:', err);
    return res.status(500).json({ error: 'Failed to send test notifications' });
  }
});

/**
 * GET /api/alerts/check-link
 * Simple polling endpoint for frontend to check if Telegram/Discord is linked.
 */
router.get('/check-link', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const address = normalizeAddress(req.query.address as string);

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .select('telegram_chat_id, discord_user_id, telegram_enabled, discord_enabled')
      .eq('wallet_address', address)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      telegramLinked: !!data?.telegram_chat_id,
      discordLinked: !!data?.discord_user_id,
      telegramEnabled: !!data?.telegram_enabled,
      discordEnabled: !!data?.discord_enabled
    });
  } catch (err: any) {
    console.error('[AlertRoutes] Check link error:', err);
    return res.status(500).json({ error: 'Failed to check link status' });
  }
});

/**
 * POST /api/alerts/discord-oauth
 * Exhanges Discord authorization code for User ID and links it to wallet.
 */
router.post('/discord-oauth', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const { address, code, signature, signedMessage, nonce } = req.body;
  const normalizedAddr = normalizeAddress(address);

  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid wallet address' });
  if (!code) return res.status(400).json({ error: 'OAuth code is required' });
  if (!signature || !signedMessage || !nonce) return res.status(401).json({ error: 'Signature and nonce are required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  // Check subscription tier
  const tier = await getEffectiveTier(supabaseAdmin, normalizedAddr);
  if (!isPremiumTier(tier)) {
    return res.status(403).json({ error: 'Alert integrations require a Pro / Premium tier.' });
  }

  // Nonce check
  const nonceCheck = await checkAndBurnNonce(supabaseAdmin, normalizedAddr, nonce);
  if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });

  // Verify signature
  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/settings';

    if (!clientId || !clientSecret) {
      throw new Error('Discord client configurations are missing on server');
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[AlertRoutes] Discord Token Exchange Failed:', errText);
      return res.status(400).json({ error: 'Failed to exchange Discord OAuth code' });
    }

    const tokenData: any = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch User Profile from Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      console.error('[AlertRoutes] Discord User Fetch Failed:', errText);
      return res.status(400).json({ error: 'Failed to retrieve Discord user profile' });
    }

    const userData: any = await userRes.json();
    const discordUserId = userData.id;

    // Upsert into alert configs
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .upsert({
        wallet_address: normalizedAddr,
        discord_user_id: discordUserId,
        discord_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ message: 'Discord linked successfully via OAuth2!', username: userData.username, config: data });
  } catch (err: any) {
    console.error('[AlertRoutes] Discord OAuth linking error:', err);
    return res.status(500).json({ error: err.message || 'Failed to authorize Discord account' });
  }
});

export default router;
