export function checkAdmin(req) {
  const secret = process.env.BADGE_ADMIN_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: 'BADGE_ADMIN_SECRET is not configured' };
  }

  const provided = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!provided || provided !== secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}
