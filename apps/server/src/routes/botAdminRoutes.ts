import express, { Request, Response } from 'express';
import { getSupabase } from '../config/supabase.ts';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Middleware to verify magic link token
const authenticateMagicLink = (req: Request, res: Response, next: any) => {
  const token = req.query.token as string || req.headers.authorization?.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!token || !jwtSecret) {
    return res.status(401).json({ error: 'Missing token or secret' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as { guildId: string, userId: string };
    if (!decoded.guildId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    // Attach guildId to request for route handlers
    (req as any).discordGuildId = decoded.guildId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * GET /api/bot/admin/config
 * Get configuration for a specific guild via magic link
 */
router.get('/config', authenticateMagicLink, async (req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

  const guildId = (req as any).discordGuildId;

  try {
    const { data: config, error } = await supabase
      .from('discord_guild_configs')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (error) throw error;
    
    // If no config exists yet, return empty object with guildId
    if (!config) {
      return res.status(200).json({ guild_id: guildId });
    }

    return res.status(200).json(config);
  } catch (err) {
    console.error('[BotAdmin] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

/**
 * POST /api/bot/admin/config
 * Update configuration for a specific guild via magic link
 */
router.post('/config', authenticateMagicLink, async (req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

  const guildId = (req as any).discordGuildId;
  const { guild_name, verified_role_id, pro_role_id, modlogs_channel_id, support_category_id } = req.body;

  try {
    const { error } = await supabase
      .from('discord_guild_configs')
      .upsert({
        guild_id: guildId,
        guild_name: guild_name || 'Unknown Server',
        verified_role_id,
        pro_role_id,
        modlogs_channel_id,
        support_category_id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'guild_id' });

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Configuration saved successfully' });
  } catch (err) {
    console.error('[BotAdmin] Save error:', err);
    return res.status(500).json({ error: 'Failed to save config' });
  }
});

export default router;
