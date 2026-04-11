import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, verifyAdminRequest } from '../_shared/admin.ts'
import { validateBadgeDefinitionPayload } from '../_shared/badgeValidation.ts'

const VALID_ACTIONS = new Set(['create', 'update', 'delete'])

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

  const action = String(body.action ?? '').trim().toLowerCase()
  const auth = await verifyAdminRequest(req, body, 'manage-badge-definition')
  if (!auth.ok) return auth.response

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const badge = body.badge && typeof body.badge === 'object' && !Array.isArray(body.badge)
    ? body.badge as Record<string, unknown>
    : null

  if (!action || !badge) {
    return jsonResponse({ error: 'action and badge are required' }, 400)
  }

  if (!VALID_ACTIONS.has(action)) {
    return jsonResponse({ error: 'action must be create, update, or delete' }, 400)
  }

  const badgeId = String(badge.badge_id ?? badge.id ?? '').trim()
  if (!badgeId) {
    return jsonResponse({ error: 'badge.badge_id is required' }, 400)
  }

  if (action === 'delete') {
    const { error } = await supabase.from('badge_definitions').delete().eq('badge_id', badgeId)
    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  } else {
    const validatedBadge = validateBadgeDefinitionPayload(badge)
    if (!validatedBadge.ok) {
      return jsonResponse({ error: validatedBadge.error }, 400)
    }

    const { error } = await supabase.from('badge_definitions').upsert(validatedBadge.badge, { onConflict: 'badge_id' })
    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  return jsonResponse({ success: true, action, badge_id: badgeId })
})