/**
 * Admin authentication helper for badge API routes.
 * Checks the request for a valid BADGE_ADMIN_API_KEY.
 *
 * Accepts the key via:
 *   - HTTP header:  x-admin-key
 *
 * Returns { ok: true } or { ok: false, error: string, status: number }.
 */
import { timingSafeEqual } from 'crypto';

export function checkAdmin(req) {
  const adminKey = process.env.BADGE_ADMIN_API_KEY || '';

  if (!adminKey) {
    return { ok: false, error: 'Server missing BADGE_ADMIN_API_KEY', status: 503 };
  }

  const provided = String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(String(adminKey), 'utf8');
  const valid = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    return { ok: false, error: 'Unauthorized', status: 401 };
  }

  return { ok: true };
}
