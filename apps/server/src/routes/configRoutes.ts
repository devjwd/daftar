import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { verifyAdminRequest } from '../services/adminService.ts';
import { SupabaseClient } from '@supabase/supabase-js';

const router = express.Router();

/**
 * GET /api/config
 * Publicly fetch global application settings
 */
router.get('/', async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    const { data, error } = await supabaseAdmin
      .from('system_config')
      .select('*');

    // If table doesn't exist or other error, return empty config instead of crashing
    if (error) {
      console.warn('[Config] Fetching system_config failed, returning default:', error.message);
      return res.status(200).json({});
    }

    // Convert array to key-value object
    const config = (data || []).reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    return res.status(200).json(config);
  } catch (err: any) {
    console.error('[Config] Unexpected error:', err);
    return res.status(200).json({});
  }
});

/**
 * POST /api/config
 * Admin-only: Update global application settings
 */
router.post('/', async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // 1. Verify Admin
    await verifyAdminRequest(req);

    const settings = req.body.settings || {};
    const updates = Object.entries(settings).map(([key, value]) => ({
      key,
      value,
      updated_at: new Date().toISOString()
    }));

    if (updates.length === 0) return res.json({ success: true, count: 0 });

    const { error } = await supabaseAdmin
      .from('system_config')
      .upsert(updates, { onConflict: 'key' });

    if (error) throw error;

    return res.json({ success: true, count: updates.length });
  } catch (err: any) {
    return res.status(err.status || 403).json({ error: err.message || 'Config update failed' });
  }
});

export default router;
