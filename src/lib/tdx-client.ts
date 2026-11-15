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
const staleCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_TDX_CACHE_ENTRIES = 150;
const MIN_REQUEST_INTERVAL_MS = 1500;

let tdxQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function scheduleTdxSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = tdxQueue.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
    return fn();
  });
  tdxQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function cleanupTdxCache() {
  const now = Date.now();
  for (const [k, v] of responseCache.entries()) {
    if (v.expiresAt <= now) {
      responseCache.delete(k);
    }
  }
  while (responseCache.size >= MAX_TDX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) break;
    responseCache.delete(oldestKey);
  }
  while (staleCache.size >= MAX_TDX_CACHE_ENTRIES) {
    const oldestKey = staleCache.keys().next().value;
    if (!oldestKey) break;
    staleCache.delete(oldestKey);
  }
}

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
 * 呼叫 TDX API 並於伺服器端快取指定秒數 (含排隊限流、併發去重與 429 備援)
 */
export async function fetchTdx<T>(path: string, ttlSeconds = 15): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const pending = inFlight.get(path);
  if (pending) {
    return pending as Promise<T>;
  }

  const task = (async () => {
    const url = `${TDX_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

    const attemptFetch = async () =>
      scheduleTdxSlot(async () => {
        const token = await getAccessToken();
        return fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
        });
      });

    try {
      let res = await attemptFetch();
      for (const waitMs of [2500, 4500]) {
        if (res.status !== 429) break;
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : waitMs;
        await sleep(Math.min(delay, 6000));
        res = await attemptFetch();
      }
      if (!res.ok) {
        throw new Error(`TDX API error (${res.status}): ${url}`);
      }

      const data = (await res.json()) as T;
      const savedAt = Date.now();
      cleanupTdxCache();
      responseCache.set(path, {
        data,
        expiresAt: savedAt + ttlSeconds * 1000,
      });
      staleCache.set(path, {
        data,
        expiresAt: savedAt + 600_000,
      });
      return data;
    } catch (err) {
      const stale = staleCache.get(path);
      if (stale && stale.expiresAt > Date.now()) {
        return stale.data as T;
      }
      throw err;
    } finally {
      inFlight.delete(path);
    }
  })();

  inFlight.set(path, task);
  return task;
}
