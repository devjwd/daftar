import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response, NextFunction } from 'express';
import { verifyAdminRequest } from '../services/adminService.ts';
import { auditBadgeDefinitions } from '../services/badgeAuditService.ts';
import { validateBadgeDefinitionPayload } from '../services/validationService.ts';
import { normalizeAddress } from '../utils/address.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { queueSync } from '../services/analyticsSyncQueue.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

// For ES Modules compatibility in Node
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const supabaseAdmin = getSupabase();
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

    if (action === 'manage-labels') {
      const { label, labels, address, method } = req.body;

      if (method === 'DELETE') {
        if (!address) return res.status(400).json({ error: 'address required' });
        const { error } = await supabaseAdmin.from('address_labels').delete().eq('address', address);
        if (error) throw error;
        return res.json({ success: true, ok: true, action: 'delete-label', address });
      }

      if (labels && Array.isArray(labels)) {
        const payload = labels.map((l: any) => ({
          address: l.address.toLowerCase(),
          entity_id: l.entity_id,
          label_name: l.label_name,
          discovery_method: l.discovery_method || 'manual'
        }));
        if (payload.length > 0) {
          const chunkSize = 1000;
          for (let i = 0; i < payload.length; i += chunkSize) {
            const chunk = payload.slice(i, i + chunkSize);
            const { error } = await supabaseAdmin.from('address_labels').upsert(chunk, { onConflict: 'address' });
            if (error) throw error;
          }
        }
        return res.json({ success: true, ok: true, action: 'bulk-create-labels', count: payload.length });
      }

      if (!label) return res.status(400).json({ error: 'label data required' });

      const payload = {
        address: label.address.toLowerCase(),
        entity_id: label.entity_id,
        label_name: label.label_name,
        discovery_method: label.discovery_method || 'manual'
      };

      const { data, error } = await supabaseAdmin.from('address_labels').upsert([payload], { onConflict: 'address' }).select('*, tracked_entities(name, logo_url)').single();
      if (error) throw error;
      return res.json({ success: true, ok: true, action: 'create-label', label: data });
    }

    if (action === 'import-allowlist') {
      const { badge_id, addresses, action_type: allowlistAction, wallet_address } = req.body;

      if (allowlistAction === 'import') {
        if (!badge_id || !Array.isArray(addresses)) return res.status(400).json({ error: 'badge_id and addresses array required' });

        // Use RPC for bulk import if available, or sequential inserts
        const rows = addresses.map(addr => ({
          badge_id,
          wallet_address: addr.toLowerCase(),
          created_at: new Date().toISOString()
        }));

        const { error } = await supabaseAdmin.from('badge_eligible_wallets').upsert(rows, { onConflict: 'badge_id,wallet_address' });
        if (error) throw error;
        return res.json({ ok: true, count: rows.length });
      }

      if (allowlistAction === 'remove') {
        if (!badge_id || !wallet_address) return res.status(400).json({ error: 'badge_id and wallet_address required' });
        const { error } = await supabaseAdmin.from('badge_eligible_wallets').delete().eq('badge_id', badge_id).eq('wallet_address', wallet_address.toLowerCase());
        if (error) throw error;
        return res.json({ ok: true });
      }

      if (allowlistAction === 'clear') {
        if (!badge_id) return res.status(400).json({ error: 'badge_id required' });
        const { error } = await supabaseAdmin.from('badge_eligible_wallets').delete().eq('badge_id', badge_id);
        if (error) throw error;
        return res.json({ ok: true });
      }
    }

    if (action === 'integrity-audit') {
      const results = await auditBadgeDefinitions(supabaseAdmin);
      return res.json({ success: true, ...results });
    }

    if (action === 'manage-users') {
      const { method, address: targetAddress, verified } = req.body;

      if (method === 'LIST') {
        const { query } = req.body;
        let dbQuery = supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: false });

        if (query) {
          dbQuery = dbQuery.or(`username.ilike.%${query}%,wallet_address.ilike.%${query}%`);
        }

        const { data, error } = await dbQuery.limit(50);
        if (error) throw error;
        return res.json({ success: true, users: data });
      }

      if (method === 'TOGGLE_VERIFICATION') {
        if (!targetAddress) return res.status(400).json({ error: 'targetAddress required' });

        const normalized = normalizeAddress(targetAddress);
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .upsert({
            wallet_address: normalized,
            is_verified: !!verified,
            updated_at: new Date().toISOString()
          }, { onConflict: 'wallet_address' })
          .select()
          .single();

        if (error) throw error;
        return res.json({ success: true, user: data });
      }
    }

    if (action === 'manage-subscriptions') {
      const { method, address: targetAddress, tier, expires_at } = req.body;

      if (method === 'LIST') {
        const { query, tierFilter } = req.body;
        let dbQuery = supabaseAdmin.from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (query) {
          dbQuery = dbQuery.or(`username.ilike.%${query}%,wallet_address.ilike.%${query}%`);
        }

        if (tierFilter && tierFilter !== 'all') {
          dbQuery = dbQuery.eq('subscription_tier', tierFilter);
        }

        const { data, error } = await dbQuery.limit(50);
        if (error) throw error;
        return res.json({ success: true, users: data });
      }

      if (method === 'SET_TIER') {
        if (!targetAddress) return res.status(400).json({ error: 'address required' });
        if (!tier || !['free', 'lite', 'pro'].includes(tier)) {
          return res.status(400).json({ error: 'Valid tier required (free, lite, pro)' });
        }

        const normalized = normalizeAddress(targetAddress);
        const updatePayload: any = {
          wallet_address: normalized,
          subscription_tier: tier,
          is_verified: tier !== 'free', // Keep is_verified in sync
          updated_at: new Date().toISOString(),
        };

        if (tier === 'free') {
          updatePayload.subscription_started_at = null;
          updatePayload.subscription_expires_at = null;
        } else {
          updatePayload.subscription_started_at = updatePayload.subscription_started_at || new Date().toISOString();
          if (expires_at) {
            updatePayload.subscription_expires_at = expires_at;
          }
        }

        const { data, error } = await supabaseAdmin
          .from('profiles')
          .upsert(updatePayload, { onConflict: 'wallet_address' })
          .select()
          .single();

        if (error) throw error;

        // If marked as pro or lite, immediately queue a background sync for the user
        if (tier === 'pro' || tier === 'lite') {
          try {
            // Initialize user_sync_status so the frontend status polling sees the user immediately
            await supabaseAdmin.from('user_sync_status').upsert({
              user_address: normalized,
              full_history_synced: false,
              synced_transactions: 0,
              total_transactions: 0,
              last_sync_at: new Date().toISOString(),
            }, { onConflict: 'user_address' });

            await queueSync(supabaseAdmin, normalized, 10);
            console.log(`[Admin] Automatically queued initial sync for newly upgraded user: ${normalized}`);
          } catch (queueErr) {
            console.error(`[Admin] Failed to auto-queue sync for upgraded user ${normalized}:`, queueErr);
          }
        }

        return res.json({ success: true, user: data });
      }
    }

    if (action === 'manage-sync-status') {
      const { method, address: targetAddress } = req.body;

      if (method === 'LIST') {
        const { query } = req.body;

        // Get all pro/verified users with their sync status
        let profileQuery = supabaseAdmin.from('profiles')
          .select('wallet_address, username, subscription_tier, is_verified, avatar_url')
          .or('is_verified.eq.true,subscription_tier.eq.pro,subscription_tier.eq.lite')
          .order('created_at', { ascending: false });

        if (query) {
          profileQuery = profileQuery.or(`username.ilike.%${query}%,wallet_address.ilike.%${query}%`);
        }

        const { data: profiles, error: profileErr } = await profileQuery.limit(100);
        if (profileErr) throw profileErr;

        if (!profiles || profiles.length === 0) {
          return res.json({ success: true, users: [] });
        }

        const wallets = profiles.map(p => p.wallet_address).filter(Boolean);

        // Fetch sync status for all these wallets
        const { data: syncStatuses } = await supabaseAdmin
          .from('user_sync_status')
          .select('*')
          .in('user_address', wallets);

        // Fetch queue status for all these wallets
        const { data: queueJobs } = await supabaseAdmin
          .from('sync_queue')
          .select('*')
          .in('user_address', wallets)
          .in('status', ['pending', 'processing', 'failed']);

        // Fetch unknown transaction counts per wallet
        const unknownCounts: Record<string, number> = {};
        for (const wallet of wallets) {
          const { count } = await supabaseAdmin
            .from('user_transaction_history')
            .select('*', { count: 'exact', head: true })
            .eq('user_address', wallet)
            .eq('protocol', 'Unknown');
          unknownCounts[wallet] = count || 0;
        }

        const syncStatusMap = new Map((syncStatuses || []).map(s => [s.user_address, s]));
        const queueMap = new Map((queueJobs || []).map(j => [j.user_address, j]));

        const users = profiles.map(profile => ({
          ...profile,
          sync_status: syncStatusMap.get(profile.wallet_address) || null,
          queue_status: queueMap.get(profile.wallet_address) || null,
          unknown_count: unknownCounts[profile.wallet_address] || 0,
        }));

        return res.json({ success: true, users });
      }

      if (method === 'FORCE_SYNC') {
        if (!targetAddress) return res.status(400).json({ error: 'address required' });
        const normalized = normalizeAddress(targetAddress);
        
        // Reset sync status so it picks up everything
        await supabaseAdmin.from('user_sync_status').upsert({
          user_address: normalized,
          full_history_synced: false,
          last_sync_at: new Date().toISOString(),
        }, { onConflict: 'user_address' });

        await queueSync(supabaseAdmin, normalized, 10);
        return res.json({ success: true, message: `Force sync queued for ${normalized}` });
      }

      if (method === 'REPROCESS_UNKNOWNS') {
        const { reProcessUnknownTransactions } = await import('../services/analyticsSyncService.ts');
        
        // Run asynchronously so the HTTP response returns immediately
        reProcessUnknownTransactions(supabaseAdmin)
          .then(() => console.log('[Admin] Finished reprocessing unknown transactions.'))
          .catch((err: any) => console.error('[Admin] Error during reprocessing:', err));

        return res.json({ success: true, message: 'Reprocess unknown transactions job triggered' });
      }
    }

    if (action === 'manage-reports') {
      const { method, id } = req.body;
      const DATA_DIR = path.resolve(__dirname, '../../data');
      const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

      if (method === 'LIST') {
        let reports: any[] = [];
        if (fs.existsSync(REPORTS_FILE)) {
          try {
            reports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
          } catch (e) {
            reports = [];
          }
        }
        return res.json({ success: true, reports });
      }

      if (method === 'DELETE') {
        if (!id) return res.status(400).json({ error: 'Report ID required' });
        let reports: any[] = [];
        if (fs.existsSync(REPORTS_FILE)) {
          try {
            reports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
          } catch (e) {}
        }
        reports = reports.filter((r: any) => r.id !== id);
        try {
          fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf-8');
        } catch (e) {}
        return res.json({ success: true, id });
      }
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

