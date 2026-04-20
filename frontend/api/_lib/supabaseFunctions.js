const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const getSupabaseBaseUrl = () =>
  normalizeBaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '');

const getSupabaseInvokeKey = () => {
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (service) return service;
  const anon = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  return anon;
};

const getFunctionApiKey = () => String(process.env.VERIFY_BADGE_API_KEY || '').trim();

export const invokeSupabaseFunction = async (name, body, { timeoutMs = 12_000 } = {}) => {
  const baseUrl = getSupabaseBaseUrl();
  const key = getSupabaseInvokeKey();

  if (!baseUrl || !key) {
    return {
      ok: false,
      status: 503,
      error: 'Supabase function invocation not configured (missing SUPABASE_URL and key)',
      data: null,
    };
  }

  const functionApiKey = getFunctionApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(functionApiKey ? { 'x-api-key': functionApiKey } : {}),
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: (parsed && (parsed.error || parsed.message)) || `Supabase function error (${response.status})`,
        data: parsed,
      };
    }

    return { ok: true, status: response.status, error: null, data: parsed };
  } catch (error) {
    const message = String(error?.name === 'AbortError' ? 'Supabase function request timed out' : error?.message || error);
    return { ok: false, status: 503, error: message.slice(0, 240), data: null };
  } finally {
    clearTimeout(timeout);
  }
};

