import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, normalizeAddress, verifyAdminRequest } from '../_shared/admin.ts'

/**
 * import-allowlist
 * Handles bulk ingestion of wallet addresses for a specific badge.
 * Expected payload: { badge_id: string, addresses: string[] }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // 1. Verify Admin Authentication
  const auth = await verifyAdminRequest(req, body, 'import-allowlist')
  if (!auth.ok) return auth.response

  const badgeId = String(body.badge_id ?? '').trim()
  const action = String(body.action ?? 'import').trim().toLowerCase()

  if (!badgeId) {
    return new Response(JSON.stringify({ error: 'badge_id is required' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 2. Handle Management Actions
  if (action === 'stats') {
    const { count, error } = await supabase
      .from('badge_eligible_wallets')
      .select('*', { count: 'exact', head: true })
      .eq('badge_id', badgeId)
    
    if (error) throw error
    return new Response(JSON.stringify({ badge_id: badgeId, count: count || 0 }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  if (action === 'search') {
    const wallet = normalizeAddress(body.wallet_address)
    if (!wallet) throw new Error('wallet_address is required for search')
    
    const { data, error } = await supabase
      .from('badge_eligible_wallets')
      .select('wallet_address')
      .eq('badge_id', badgeId)
      .eq('wallet_address', wallet)
      .maybeSingle()
    
    if (error) throw error
    return new Response(JSON.stringify({ badge_id: badgeId, wallet_address: wallet, found: !!data }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  if (action === 'remove') {
    const wallet = normalizeAddress(body.wallet_address)
    if (!wallet) throw new Error('wallet_address is required for removal')

    const { error } = await supabase
      .from('badge_eligible_wallets')
      .delete()
      .eq('badge_id', badgeId)
      .eq('wallet_address', wallet)
    
    if (error) throw error
    return new Response(JSON.stringify({ success: true, removed: wallet }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  if (action === 'clear') {
    const { error } = await supabase
      .from('badge_eligible_wallets')
      .delete()
      .eq('badge_id', badgeId)
    
    if (error) throw error
    return new Response(JSON.stringify({ success: true, badge_id: badgeId, action: 'cleared' }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // 3. Original Import Logic (for action === 'import')
  const addresses = Array.isArray(body.addresses) ? body.addresses : []
  if (addresses.length === 0) {
    return new Response(JSON.stringify({ error: 'addresses array is required for import' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // 4. Normalize and Deduplicate Addresses
  const normalized = [...new Set(
    addresses
      .map(addr => normalizeAddress(addr))
      .filter(Boolean)
  )]

  if (normalized.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid addresses found in payload' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // 5. Batch Ingestion
  const BATCH_SIZE = 500
  let successCount = 0
  
  try {
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE).map(addr => ({
        badge_id: badgeId,
        wallet_address: addr
      }))

      const { error } = await supabase
        .from('badge_eligible_wallets')
        .upsert(batch, { onConflict: 'badge_id, wallet_address' })

      if (error) throw error
      successCount += batch.length
    }
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: 'Incomplete import', 
      details: err.message,
      processed: successCount 
    }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ 
    success: true, 
    badge_id: badgeId, 
    imported: successCount 
  }), {
    status: 200,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
})
