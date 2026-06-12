import { devLog } from "../../utils/devLogger";
import { DEFAULT_NETWORK } from "../../config/network";

const REQUEST_TIMEOUT_MS = 10_000;

export const resolveEnv = () => {
  const env = (typeof import.meta !== "undefined" && (import.meta as any).env) ? (import.meta as any).env : {};
  return {
    rpcUrl: String(env.VITE_MOVEMENT_RPC_URL || DEFAULT_NETWORK.rpc || "").trim() || null,
    indexerUrl: String(env.VITE_MOVEMENT_INDEXER_URL || DEFAULT_NETWORK.indexer || "").trim() || null,
  };
};

export const fetchWithTimeout = async (url: string, options: any = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const parseJsonSafe = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const postGraphQL = async (query: string, variables = {}) => {
  const { indexerUrl } = resolveEnv();
  if (!indexerUrl) {
    devLog("Indexer request failed: missing indexer URL");
    return { data: null, error: "Missing indexer URL" };
  }
  try {
    const response = await fetchWithTimeout(indexerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) return { data: null, error: "HTTP Error" };
    const json = await parseJsonSafe(response);
    if (!json) return { data: null, error: "Invalid JSON response" };
    if (json.errors?.length > 0) return { data: null, error: json.errors[0]?.message };
    return { data: json.data || null, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
};
