import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders, jsonResponse, verifyAdminRequest } from '../_shared/admin.ts'
import { validateBadgeDefinitionPayload } from '../_shared/badgeValidation.ts'

const VALID_ACTIONS = new Set(['create', 'update', 'delete', 'batch_sync'])

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

  const action = String(body.action ?? '').trim().toLowerCase()
  const auth = await verifyAdminRequest(req, body, 'manage-badge-definition')
  if (!auth.ok) return auth.response

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (action === 'batch_sync') {
    const badges = Array.isArray(body.badges) ? body.badges : []
    if (badges.length === 0) {
      return jsonResponse({ success: true, count: 0 }, 200, req)
    }

    const validatedBadges = badges.map(b => validateBadgeDefinitionPayload(b)).filter(v => v.ok).map(v => v.badge)
    
    const { error } = await supabase.from('badge_definitions').upsert(validatedBadges, { onConflict: 'badge_id' })
    if (error) {
      return jsonResponse({ error: error.message }, 500, req)
    }

    return jsonResponse({ success: true, action, count: validatedBadges.length }, 200, req)
  }

  const badge = body.badge && typeof body.badge === 'object' && !Array.isArray(body.badge)
    ? body.badge as Record<string, unknown>
    : null

  if (!action || !badge) {
    return new Response(JSON.stringify({ error: 'action and badge are required' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  if (!VALID_ACTIONS.has(action)) {
    return new Response(JSON.stringify({ error: 'action must be create, update, or delete' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  const badgeId = String(badge.badge_id ?? badge.id ?? '').trim()
  if (!badgeId) {
    return new Response(JSON.stringify({ error: 'badge.badge_id is required' }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  if (action === 'delete') {
    const { error } = await supabase.from('badge_definitions').delete().eq('badge_id', badgeId)
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }
  } else {
    const validatedBadge = validateBadgeDefinitionPayload(badge)
    if (!validatedBadge.ok) {
      return new Response(JSON.stringify({ error: validatedBadge.error }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    const { error } = await supabase.from('badge_definitions').upsert(validatedBadge.badge, { onConflict: 'badge_id' })
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }
  }

  return new Response(JSON.stringify({ success: true, action, badge_id: badgeId }), {
    status: 200,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
})