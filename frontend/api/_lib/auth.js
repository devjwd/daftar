export function checkAdmin(_req) {
  return {
    ok: false,
    error: 'Legacy Vercel badge admin routes are disabled. Use the Supabase wallet-signed admin flow instead.',
    status: 410,
  };
}
