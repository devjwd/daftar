/**
 * Admin authentication helper for badge API routes.
 * Checks the request for a valid BADGE_ADMIN_API_KEY.
 *
 * Accepts the key via:
 *   - HTTP header:  x-admin-key
 *   - JSON body:    { adminKey: "..." }
 *
 * Returns { ok: true } or { ok: false, error: string, status: number }.
 */
export function checkAdmin(req) {
  const adminKey = process.env.BADGE_ADMIN_API_KEY || '';

  if (!adminKey) {
    return { ok: false, error: 'Server missing BADGE_ADMIN_API_KEY', status: 503 };
  }

  const provided = req.headers['x-admin-key'] || req.body?.adminKey;
  if (provided !== adminKey) {
    return { ok: false, error: 'Unauthorized', status: 401 };
  }

  return { ok: true };
}
