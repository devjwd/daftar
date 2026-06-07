import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { normalizeAddress } from '../utils/address.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';
import { checkRateLimit, checkAndBurnNonce } from '../services/dbService.ts';
import { verifyWalletSignature } from '../utils/crypto.ts';
import { getEffectiveTier } from '../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';
import { sendEmailAlert, sendTelegramAlert, sendDiscordAlert } from '../services/notificationService.ts';

const router = express.Router();

/**
 * GET /api/alerts/config
 * Retrieves the current alert configuration for a wallet
 * Authenticated via signature verification
 */
router.get('/config', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const address = normalizeAddress(req.query.address as string);
  const signature = req.query.signature as string;
  const message = req.query.message as string;
  const nonce = req.query.nonce as string;

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!signature || !message || !nonce) return res.status(401).json({ error: 'Signature and nonce are required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  // Nonce check
  const nonceCheck = await checkAndBurnNonce(supabaseAdmin, address, nonce);
  if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });

  // Verify signature
  const isValid = verifyWalletSignature(address, message, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .select('*')
      .eq('wallet_address', address)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json(data || {
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
    });
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
    const { data, error } = await supabaseAdmin
      .from('user_alert_configs')
      .upsert({
        wallet_address: normalizedAddr,
        email: email || null,
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

export default router;
