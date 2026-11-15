/**
 * 交通部 TDX (Transport Data eXchange) API 中繼客戶端
 * 負責 OAuth 2.0 Client Credentials 認證與伺服器端快取，避免觸發 Rate Limit (429)。
 */

const TDX_AUTH_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
const responseCache = new Map<string, CacheEntry<unknown>>();

export function isTdxConfigured(): boolean {
  const id = process.env.TDX_CLIENT_ID?.trim();
  const secret = process.env.TDX_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.TDX_CLIENT_ID?.trim();
  const clientSecret = process.env.TDX_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error('TDX_CLIENT_ID or TDX_CLIENT_SECRET is not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(TDX_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`TDX auth failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * 呼叫 TDX API 並於伺服器端快取指定秒數
 */
export async function fetchTdx<T>(path: string, ttlSeconds = 15): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const token = await getAccessToken();
  const url = `${TDX_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`TDX API error (${res.status}): ${url}`);
  }

  const data = (await res.json()) as T;
  responseCache.set(path, {
    data,
    expiresAt: now + ttlSeconds * 1000,
  });
  return data;
}
