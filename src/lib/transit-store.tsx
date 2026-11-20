'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useUserLocation } from './location';
import { METRO_SYSTEMS, THSR_STATIONS, TRA_STATIONS } from './mock-data';
import { findNearestMetroStation, findNearestRailStation } from './rail-geo';

interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
}

type ActiveGroup = 'opendata' | 'metro' | 'tra' | 'thsr';

interface ActiveTarget {
  key: string;
  url: string;
  group: ActiveGroup;
}

interface TransitStoreContextValue {
  /** 全域每秒更新的本地時鐘 (epoch ms)，用來即時重算倒數、距發車分鐘數與動畫 */
  nowMs: number;
  /** 全域統一背景同步倒數秒數 (30 -> 0)，換頁不會重置 */
  syncCountdown: number;
  /** 全域統一背景同步是否進行中 */
  isSyncing: boolean;
  /** 全域統一同步版本號，每次統一更新完成後遞增，供各頁讀取最新快取 */
  syncVersion: number;
  /** 最近一次同步時間字串 */
  lastSyncLabel: string;
  /** 手動僅更新前端時間戳 (不重打後端 API) */
  triggerFrontendRefresh: () => string;
  /** 從前端記憶體或 sessionStorage 快取讀取已載入資料 */
  getCached: <T>(key: string) => CacheEntry<T> | undefined;
  /** 透過共享快取 + in-flight 去重向後端取得資料；已有快取且非 force 時不重打後端 */
  fetchWithCache: <T>(
    key: string,
    url: string,
    options?: { signal?: AbortSignal; force?: boolean }
  ) => Promise<T>;
}

const SYNC_INTERVAL_SEC = 30;
const SESSION_STORAGE_KEY = 'tw-transit-cache-v1';
const SESSION_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 30;

const TransitStoreContext = createContext<TransitStoreContextValue | null>(null);

function resolveGroupFromKey(key: string): { slot: string; group: ActiveGroup } {
  if (key.startsWith('metro:')) return { slot: 'metro', group: 'metro' };
  if (key.startsWith('tra:')) return { slot: 'tra', group: 'tra' };
  if (key.startsWith('thsr:')) return { slot: 'thsr', group: 'thsr' };
  if (key.startsWith('bus:detail:')) return { slot: 'bus:detail', group: 'opendata' };
  if (key.startsWith('bus:')) return { slot: 'bus:list', group: 'opendata' };
  if (key.startsWith('youbike:')) return { slot: 'youbike', group: 'opendata' };
  if (key.startsWith('parking:')) return { slot: 'parking', group: 'opendata' };
  return { slot: key, group: 'opendata' };
}

function countPayloadItems(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  for (const field of ['trains', 'stations', 'lots', 'routes', 'stops']) {
    const val = obj[field];
    if (Array.isArray(val)) return val.length;
    if (val && typeof val === 'object') return Object.keys(val).length;
  }
  return null;
}

function shouldKeepOldData(prevData: unknown, nextData: unknown): boolean {
  const prevCount = countPayloadItems(prevData);
  const nextCount = countPayloadItems(nextData);
  return prevCount !== null && prevCount > 0 && nextCount === 0;
}

export function TransitStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [nowMs, setNowMs] = useState<number>(0);
  const [syncCountdown, setSyncCountdown] = useState<number>(SYNC_INTERVAL_SEC);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncVersion, setSyncVersion] = useState<number>(0);
  const [lastSyncLabel, setLastSyncLabel] = useState<string>('');

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const activeTargetsRef = useRef<Map<string, ActiveTarget>>(new Map());
  const preloadedRef = useRef(false);
  const hydratedRef = useRef(false);
  const lastSyncAtRef = useRef<number>(0);
  const { coords, ready } = useUserLocation();

  const persistToSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const entries = Array.from(cacheRef.current.entries())
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, MAX_CACHE_ENTRIES);
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // sessionStorage quota exceeded or unavailable
    }
  }, []);

  const hydrateFromSession = useCallback(() => {
    if (hydratedRef.current || typeof window === 'undefined') return;
    hydratedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as [string, CacheEntry][];
      if (!Array.isArray(parsed)) return;
      const now = Date.now();
      for (const [k, entry] of parsed) {
        if (entry && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt <= SESSION_MAX_AGE_MS) {
          cacheRef.current.set(k, entry);
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const setCacheEntry = useCallback(
    (key: string, data: unknown) => {
      const existing = cacheRef.current.get(key);
      if (existing && shouldKeepOldData(existing.data, data)) {
        return existing.data;
      }
      if (cacheRef.current.size >= MAX_CACHE_ENTRIES && !cacheRef.current.has(key)) {
        const oldestKey = cacheRef.current.keys().next().value;
        if (oldestKey) cacheRef.current.delete(oldestKey);
      }
      cacheRef.current.set(key, { data, fetchedAt: Date.now() });
      persistToSession();
      return data;
    },
    [persistToSession]
  );

  const getCached = useCallback(
    <T,>(key: string): CacheEntry<T> | undefined => {
      hydrateFromSession();
      return cacheRef.current.get(key) as CacheEntry<T> | undefined;
    },
    [hydrateFromSession]
  );

  const fetchWithCache = useCallback(
    async <T,>(
      key: string,
      url: string,
      options?: { signal?: AbortSignal; force?: boolean }
    ): Promise<T> => {
      hydrateFromSession();

      const { slot, group } = resolveGroupFromKey(key);
      activeTargetsRef.current.set(slot, { key, url, group });

      if (!options?.force) {
        const existing = cacheRef.current.get(key);
        if (existing) {
          return existing.data as T;
        }
        const inflight = inFlightRef.current.get(key) as Promise<T> | undefined;
        if (inflight) return inflight;
      }

      const promise = fetch(url, {
        cache: 'no-store',
        signal: options?.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const rawData = (await res.json()) as T;
          const finalData = setCacheEntry(key, rawData) as T;
          setSyncVersion((v) => v + 1);
          return finalData;
        })
        .finally(() => {
          if (inFlightRef.current.get(key) === promise) {
            inFlightRef.current.delete(key);
          }
        });

      inFlightRef.current.set(key, promise);
      return promise;
    },
    [hydrateFromSession, setCacheEntry]
  );

  const syncAllActive = useCallback(async () => {
    const targets = Array.from(activeTargetsRef.current.values());
    if (targets.length === 0) return;

    setIsSyncing(true);
    lastSyncAtRef.current = Date.now();

    const runGroup = async (groupFilter: ActiveGroup) => {
      const items = targets.filter((t) => t.group === groupFilter);
      await Promise.allSettled(
        items.map((t) => fetchWithCache(t.key, t.url, { force: true }))
      );
    };

    try {
      await Promise.allSettled([runGroup('opendata'), runGroup('metro')]);
      await new Promise((r) => setTimeout(r, 450));
      await runGroup('tra');
      await new Promise((r) => setTimeout(r, 450));
      await runGroup('thsr');

      const now = Date.now();
      lastSyncAtRef.current = now;
      setLastSyncLabel(
        new Date(now).toLocaleTimeString('zh-TW', { hour12: false })
      );
      setSyncVersion((v) => v + 1);
    } finally {
      setIsSyncing(false);
    }
  }, [fetchWithCache]);

  const syncAllActiveRef = useRef(syncAllActive);
  useEffect(() => {
    syncAllActiveRef.current = syncAllActive;
  }, [syncAllActive]);

  // 全域 1 秒時鐘 + 統一 30 秒背景同步排程（不隨切頁重置）
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        setNowMs(now);
        if (
          lastSyncAtRef.current > 0 &&
          now - lastSyncAtRef.current >= SYNC_INTERVAL_SEC * 1000
        ) {
          setSyncCountdown(SYNC_INTERVAL_SEC);
          void syncAllActiveRef.current();
        }
      }
    };

    const initTimer = setTimeout(() => setNowMs(Date.now()), 0);
    document.addEventListener('visibilitychange', handleVisibility);

    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNowMs(Date.now());
      setSyncCountdown((prev) => {
        if (prev <= 1) {
          void syncAllActiveRef.current();
          return SYNC_INTERVAL_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const triggerFrontendRefresh = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    const label = new Date(now).toLocaleTimeString('zh-TW', { hour12: false });
    setLastSyncLabel(label);
    return label;
  }, []);

  // 開站僅執行一次後端預載（Key 與各頁面 100% 對齊）
  useEffect(() => {
    if (!ready || preloadedRef.current) return;
    preloadedRef.current = true;
    hydrateFromSession();
    lastSyncAtRef.current = Date.now();

    const ybQs = new URLSearchParams({ q: '' });
    if (coords) {
      ybQs.set('lat', String(coords.lat));
      ybQs.set('lng', String(coords.lng));
      ybQs.set('maxDistance', '3000');
    }
    void fetchWithCache(
      `youbike:${ybQs.toString()}`,
      `/api/transit/youbike?${ybQs.toString()}`
    ).catch(() => {});

    const pkQs = new URLSearchParams({ q: '', onlyAvailable: 'false' });
    if (coords) {
      pkQs.set('lat', String(coords.lat));
      pkQs.set('lng', String(coords.lng));
      pkQs.set('maxDistance', '3000');
    }
    void fetchWithCache(
      `parking:${pkQs.toString()}`,
      `/api/transit/parking?${pkQs.toString()}`
    ).catch(() => {});

    const busQs = new URLSearchParams({ city: 'Taipei', q: '' });
    if (coords) {
      busQs.set('lat', String(coords.lat));
      busQs.set('lng', String(coords.lng));
    }
    const busCoordKey = coords
      ? `${coords.lat.toFixed(3)},${coords.lng.toFixed(3)}`
      : 'none';
    void fetchWithCache(
      `bus:list:Taipei::${busCoordKey}`,
      `/api/transit/bus?${busQs.toString()}`
    ).catch(() => {});

    const nearestMetro = coords
      ? findNearestMetroStation(coords.lat, coords.lng, METRO_SYSTEMS)
      : null;
    const mSys = nearestMetro?.systemId || 'TRTC';
    void fetchWithCache(
      `metro:snapshot:${mSys}`,
      `/api/transit/metro?system=${encodeURIComponent(mSys)}&mode=snapshot`
    ).catch(() => {});

    const nearestTra = coords
      ? findNearestRailStation(coords.lat, coords.lng, TRA_STATIONS, 'tra')
      : null;
    const traSt = nearestTra?.id || '1000';
    const tTra = setTimeout(() => {
      void fetchWithCache(
        `tra:board:${traSt}`,
        `/api/transit/tra?mode=board&station=${encodeURIComponent(traSt)}`
      ).catch(() => {});
    }, 600);

    const nearestThsr = coords
      ? findNearestRailStation(coords.lat, coords.lng, THSR_STATIONS, 'thsr')
      : null;
    const thsrFrom = nearestThsr?.id || '1000';
    const tThsr = setTimeout(() => {
      void fetchWithCache(
        `thsr:board:${thsrFrom}`,
        `/api/transit/thsr?from=${encodeURIComponent(thsrFrom)}`
      ).catch(() => {});
    }, 1200);

    return () => {
      clearTimeout(tTra);
      clearTimeout(tThsr);
    };
  }, [ready, coords, fetchWithCache, hydrateFromSession]);

  return (
    <TransitStoreContext.Provider
      value={{
        nowMs,
        syncCountdown,
        isSyncing,
        syncVersion,
        lastSyncLabel,
        triggerFrontendRefresh,
        getCached,
        fetchWithCache,
      }}
    >
      {children}
    </TransitStoreContext.Provider>
  );
}

export function useTransitStore(): TransitStoreContextValue {
  const ctx = useContext(TransitStoreContext);
  if (!ctx) {
    throw new Error('useTransitStore must be used inside TransitStoreProvider');
  }
  return ctx;
}
