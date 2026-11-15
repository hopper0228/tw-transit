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

interface TransitStoreContextValue {
  /** 全域每秒更新的本地時鐘 (epoch ms)，用來即時重算倒數、距發車分鐘數與動畫 */
  nowMs: number;
  /** 手動僅更新前端時間戳 (不重打後端 API) */
  triggerFrontendRefresh: () => string;
  /** 從前端記憶體快取讀取已載入資料 */
  getCached: <T>(key: string) => CacheEntry<T> | undefined;
  /** 透過共享快取 + in-flight 去重向後端取得資料 */
  fetchWithCache: <T>(
    key: string,
    url: string,
    options?: { signal?: AbortSignal; force?: boolean }
  ) => Promise<T>;
}

const TransitStoreContext = createContext<TransitStoreContextValue | null>(null);

export function TransitStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [nowMs, setNowMs] = useState<number>(0);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const preloadedRef = useRef(false);
  const { coords, ready } = useUserLocation();

  // 全域 1 秒時鐘：掛載後立即對齊並每秒更新，頁面隱藏時暫停，切回前景時立即校正
  useEffect(() => {
    const syncClock = () => {
      if (document.visibilityState === 'visible') {
        setNowMs(Date.now());
      }
    };
    const initTimer = setTimeout(() => setNowMs(Date.now()), 0);
    document.addEventListener('visibilitychange', syncClock);
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', syncClock);
    };
  }, []);

  const triggerFrontendRefresh = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    return new Date(now).toLocaleTimeString('zh-TW', { hour12: false });
  }, []);

  const getCached = useCallback(<T,>(key: string): CacheEntry<T> | undefined => {
    return cacheRef.current.get(key) as CacheEntry<T> | undefined;
  }, []);

  const fetchWithCache = useCallback(
    async <T,>(
      key: string,
      url: string,
      options?: { signal?: AbortSignal; force?: boolean }
    ): Promise<T> => {
      if (!options?.force) {
        const inflight = inFlightRef.current.get(key) as Promise<T> | undefined;
        if (inflight) return inflight;
      }

      const promise = fetch(url, {
        cache: 'no-store',
        signal: options?.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as T;
          cacheRef.current.set(key, { data, fetchedAt: Date.now() });
          return data;
        })
        .finally(() => {
          if (inFlightRef.current.get(key) === promise) {
            inFlightRef.current.delete(key);
          }
        });

      inFlightRef.current.set(key, promise);
      return promise;
    },
    []
  );

  // 開站背景分級預載：一旦定位就緒（最多等 3s）立即錯峰預熱各運具
  useEffect(() => {
    if (!ready || preloadedRef.current) return;
    preloadedRef.current = true;

    const latLngQs = coords
      ? `&lat=${coords.lat}&lng=${coords.lng}`
      : '';

    // 第 1 批：OpenData（0 TDX 額度）+ 最近捷運站
    const ybUrl = `/api/transit/youbike?q=${coords ? `&lat=${coords.lat}&lng=${coords.lng}&maxDistance=3000` : ''}`.replace('q=&', '');
    void fetchWithCache('youbike:init', ybUrl).catch(() => {});

    const pkUrl = `/api/transit/parking?q=&onlyAvailable=false${coords ? `&lat=${coords.lat}&lng=${coords.lng}&maxDistance=3000` : ''}`;
    void fetchWithCache('parking:init', pkUrl).catch(() => {});

    const busUrl = `/api/transit/bus?city=Taipei&q=${latLngQs}`;
    void fetchWithCache('bus:list:Taipei:', busUrl).catch(() => {});

    const nearestMetro = coords
      ? findNearestMetroStation(coords.lat, coords.lng, METRO_SYSTEMS)
      : null;
    const mSys = nearestMetro?.systemId || 'TRTC';
    void fetchWithCache(
      `metro:snapshot:${mSys}`,
      `/api/transit/metro?system=${encodeURIComponent(mSys)}&mode=snapshot`
    ).catch(() => {});

    // 第 2 批：錯峰預熱台鐵與高鐵索引
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
    const thsrTo = thsrFrom === '1040' ? '1070' : '1040';
    const tThsr = setTimeout(() => {
      void fetchWithCache(
        `thsr:${thsrFrom}:${thsrTo}`,
        `/api/transit/thsr?from=${encodeURIComponent(thsrFrom)}&to=${encodeURIComponent(thsrTo)}`
      ).catch(() => {});
    }, 1200);

    return () => {
      clearTimeout(tTra);
      clearTimeout(tThsr);
    };
  }, [ready, coords, fetchWithCache]);

  return (
    <TransitStoreContext.Provider
      value={{
        nowMs,
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
