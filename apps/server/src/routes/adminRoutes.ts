import express, { Request, Response, NextFunction } from 'express';
import { verifyAdminRequest } from '../services/adminService.ts';
import { auditBadgeDefinitions } from '../services/syncService.ts';
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
      const validated = list
        .map(b => validateBadgeDefinitionPayload(b))
        .filter(v => v.ok)
        .map(v => v.badge);
        
      if (validated.length === 0) return res.json({ success: true, count: 0 });

      const { error } = await supabaseAdmin.from('badge_definitions').upsert(validated, { onConflict: 'badge_id' });
      if (error) throw error;
      return res.json({ success: true, action, count: validated.length });
    }

    if (action === 'list-all-badges') {
      const { include_deleted } = req.body;
      let query = supabaseAdmin
        .from('badge_definitions')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!include_deleted) {
        query = query.eq('is_deleted', false);
      }
      
      const { data, error } = await query;
      
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

    if (action === 'manage-entities') {
      const { entity, id, method } = req.body;
      
      if (method === 'DELETE') {
        if (!id) return res.status(400).json({ error: 'id required' });
        const { error } = await supabaseAdmin.from('tracked_entities').delete().eq('id', id);
        if (error) throw error;
        return res.json({ success: true, ok: true, action: 'delete-entity', id });
      }

      // Handle POST (Create/Update)
      if (!entity) return res.status(400).json({ error: 'entity data required' });
      
      const payload = {
        address: entity.address.toLowerCase(),
        name: entity.name,
        category: entity.category,
        logo_url: entity.logo_url,
        website_url: entity.website_url,
        twitter_url: entity.twitter_url,
        custom_type: entity.custom_type,
        badge_color: entity.badge_color,
        is_verified: !!entity.is_verified,
        updated_at: new Date().toISOString()
      };

      if (entity.id || id) {
        // Update
        const targetId = entity.id || id;
        const { data, error } = await supabaseAdmin.from('tracked_entities').update(payload).eq('id', targetId).select().single();
        if (error) throw error;
        return res.json({ success: true, ok: true, action: 'update-entity', entity: data });
      } else {
        // Create
        const { data, error } = await supabaseAdmin.from('tracked_entities').insert([payload]).select().single();
        if (error) throw error;
        return res.json({ success: true, ok: true, action: 'create-entity', entity: data });
      }
    }

    if (action === 'import-allowlist') {
      const { badge_id, addresses, action: allowlistAction, wallet_address } = req.body;
      
      if (allowlistAction === 'import') {
        if (!badge_id || !Array.isArray(addresses)) return res.status(400).json({ error: 'badge_id and addresses array required' });
        
        // Use RPC for bulk import if available, or sequential inserts
        const rows = addresses.map(addr => ({
          badge_id,
          wallet_address: addr.toLowerCase(),
          created_at: new Date().toISOString()
        }));

        const { error } = await supabaseAdmin.from('badge_allowlists').upsert(rows, { onConflict: 'badge_id,wallet_address' });
        if (error) throw error;
        return res.json({ ok: true, count: rows.length });
      }

      if (allowlistAction === 'remove') {
        if (!badge_id || !wallet_address) return res.status(400).json({ error: 'badge_id and wallet_address required' });
        const { error } = await supabaseAdmin.from('badge_allowlists').delete().eq('badge_id', badge_id).eq('wallet_address', wallet_address.toLowerCase());
        if (error) throw error;
        return res.json({ ok: true });
      }

      if (allowlistAction === 'clear') {
        if (!badge_id) return res.status(400).json({ error: 'badge_id required' });
        const { error } = await supabaseAdmin.from('badge_allowlists').delete().eq('badge_id', badge_id);
        if (error) throw error;
        return res.json({ ok: true });
      }
    }

    if (action === 'integrity-audit') {
      const results = await auditBadgeDefinitions(supabaseAdmin);
      return res.json({ success: true, ...results });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

