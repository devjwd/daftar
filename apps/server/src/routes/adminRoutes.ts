import express, { Request, Response, NextFunction } from 'express';
import { verifyAdminRequest } from '../services/adminService.ts';
import { validateBadgeDefinitionPayload } from '../services/validationService.ts';
import { SupabaseClient } from '@supabase/supabase-js';

const router = express.Router();

// All admin routes require admin signature verification
router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await verifyAdminRequest(req);
    next();
  } catch (authErr: any) {
    res.status(403).json({ error: authErr.message || 'Admin authentication failed' });
  }
});

/**
 * POST /api/admin/manage-badge
 */
router.post('/manage-badge', async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

  const { action, badge, badges } = req.body;

  try {
    if (action === 'batch_sync') {
      const list = Array.isArray(badges) ? badges : [];
      const validated = list.map(b => validateBadgeDefinitionPayload(b)).filter(v => v.ok).map(v => v.badge);
      if (validated.length === 0) return res.json({ success: true, count: 0 });

      const { error } = await supabaseAdmin.from('badge_definitions').upsert(validated, { onConflict: 'badge_id' });
      if (error) throw error;
      return res.json({ success: true, action, count: validated.length });
    }

    if (action === 'list-all-badges') {
      const { data, error } = await supabaseAdmin
        .from('badge_definitions')
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return res.json({ success: true, action, badges: data });
    }

    if (action === 'delete') {
      const badgeId = badge?.badge_id || badge?.id;
      if (!badgeId) return res.status(400).json({ error: 'badge_id required' });
      const { error } = await supabaseAdmin
        .from('badge_definitions')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('badge_id', badgeId);
      if (error) throw error;
      return res.json({ success: true, action, badge_id: badgeId, soft_deleted: true });
    }

    if (action === 'restore') {
      const badgeId = badge?.badge_id || badge?.id;
      if (!badgeId) return res.status(400).json({ error: 'badge_id required' });
      const { error } = await supabaseAdmin
        .from('badge_definitions')
        .update({ is_deleted: false, updated_at: new Date().toISOString() })
        .eq('badge_id', badgeId);
      if (error) throw error;
      return res.json({ success: true, action, badge_id: badgeId, restored: true });
    }

    if (action === 'toggle-status') {
      const badgeId = badge?.badge_id || badge?.id;
      if (!badgeId) return res.status(400).json({ error: 'badge_id required' });
      const { error } = await supabaseAdmin
        .from('badge_definitions')
        .update({ 
          enabled: !!badge.enabled, 
          is_active: !!badge.enabled,
          updated_at: new Date().toISOString() 
        })
        .eq('badge_id', badgeId);
      if (error) throw error;
      return res.json({ success: true, action, badge_id: badgeId });
    }

    if (action === 'toggle-public') {
      const badgeId = badge?.badge_id || badge?.id;
      if (!badgeId) return res.status(400).json({ error: 'badge_id required' });
      const { error } = await supabaseAdmin
        .from('badge_definitions')
        .update({ 
          is_public: !!badge.is_public,
          updated_at: new Date().toISOString() 
        })
        .eq('badge_id', badgeId);
      if (error) throw error;
      return res.json({ success: true, action, badge_id: badgeId });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

