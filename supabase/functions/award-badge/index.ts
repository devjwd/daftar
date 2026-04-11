import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, normalizeAddress, verifyAdminRequest } from '../_shared/admin.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const auth = await verifyAdminRequest(req, body, 'award-badge')
  if (!auth.ok) return auth.response

  const walletAddress = normalizeAddress(body.wallet_address)
  const badgeId = String(body.badge_id ?? '').trim()

  if (!walletAddress || !badgeId) {
    return jsonResponse({ error: 'wallet_address and badge_id are required' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase.from('badge_attestations').upsert(
    {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: true,
      verified_at: new Date().toISOString(),
    },
    { onConflict: 'wallet_address,badge_id' }
  )

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  return jsonResponse({ success: true, wallet_address: walletAddress, badge_id: badgeId })
})