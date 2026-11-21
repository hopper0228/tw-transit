'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  Bus,
  ChevronRight,
  ExternalLink,
  Keyboard,
  List,
  Map as MapIcon,
  Search,
  Star,
  Zap,
} from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import DetailDrawer from '@/components/DetailDrawer';
import LocationBanner from '@/components/LocationBanner';
import { formatDistance, useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
import { BUS_CITIES } from '@/lib/mock-data';
import { BusRouteDetail, BusRouteInfo, BusStopStatus } from '@/lib/types';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import type { MapMarker } from '@/components/LeafletMap';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
      地圖載入中...
    </div>
  ),
});

const BUS_KEYPAD = [
  '1', '2', '3', '紅', '藍',
  '4', '5', '6', '綠', '棕',
  '7', '8', '9', '橘', '幹線',
  '0', '小', '內科', '清除',
];

function formatEtaBadge(stop: BusStopStatus, offsetSec = 0) {
  if (stop.estimateSeconds === null || stop.stopStatus !== 0) {
    return {
      text: stop.stopStatus === 3 ? '末班已過' : '尚未發車',
      className:
        'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  const sec = Math.max(0, stop.estimateSeconds - offsetSec);
  if (sec <= 45) {
    return {
      text: '進站中',
      className: 'bg-red-600 text-white animate-pulse shadow-xs',
    };
  }
  const min = Math.ceil(sec / 60);
  if (min <= 3) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return {
      text: `${m}分${String(s).padStart(2, '0')}秒`,
      className: 'bg-orange-500 text-white shadow-xs',
    };
  }
  return {
    text: `${min} 分`,
    className:
      'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
  };
}

function BusPageInner() {
  const searchParams = useSearchParams();
  const initialCity = searchParams.get('city') || 'Taipei';
  const initialRoute = searchParams.get('route');

  const { coords, status: locStatus, refreshLocation } = useUserLocation();
  const { nowMs, syncVersion, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [detailFetchedAt, setDetailFetchedAt] = useState<number>(0);
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');
  const [city, setCity] = useState(initialCity);
  const [query, setQuery] = useState('');
  const [showKeypad, setShowKeypad] = useState(false);
  const [routes, setRoutes] = useState<BusRouteInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // 路線詳情狀態
  const [selectedRoute, setSelectedRoute] = useState<string | null>(initialRoute);
  const [selectedRouteCity, setSelectedRouteCity] = useState<string>(initialCity);
  const [direction, setDirection] = useState<0 | 1>(0);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list'); // 預設為台北等公車垂直列表模式
  const [detail, setDetail] = useState<BusRouteDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [faved, setFaved] = useState(false);
  const [selectedStop, setSelectedStop] = useState<BusStopStatus | null>(null);

  // 取得路線清單（立即載入預設/快取，定位取得後自動背景依距離重排）
  useEffect(() => {
    const controller = new AbortController();
    const key = `bus:list:${city}:${query}:${coords ? `${coords.lat.toFixed(3)},${coords.lng.toFixed(3)}` : 'none'}`;
    const qs = new URLSearchParams({ city, q: query });
    if (coords) {
      qs.set('lat', String(coords.lat));
      qs.set('lng', String(coords.lng));
    }

    const t = setTimeout(() => {
      const cached = getCached<{ routes?: BusRouteInfo[] }>(key);
      if (cached) {
        setRoutes(cached.data.routes || []);
        setLoadingList(false);
      } else {
        setLoadingList(true);
      }

      fetchWithCache<{ routes?: BusRouteInfo[] }>(
        key,
        `/api/transit/bus?${qs.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          setRoutes(data.routes || []);
        })
        .catch(() => {
          // ignore abort
        })
        .finally(() => {
          setLoadingList(false);
        });
    }, 0);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [city, query, coords, getCached, fetchWithCache, syncVersion]);

  const loadDetail = useCallback(
    async (routeName: string, dir: 0 | 1, signal?: AbortSignal, force = false) => {
      const key = `bus:detail:${selectedRouteCity}:${routeName}:${dir}`;
      const cached = getCached<BusRouteDetail>(key);
      if (cached && !force) {
        setDetail(cached.data);
        setDetailFetchedAt(cached.fetchedAt);
        setFaved(isFavorite(`bus-${cached.data.route.city}-${cached.data.route.routeName}`));
        setLoadingDetail(false);
      } else {
        setLoadingDetail(true);
      }

      try {
        const data = await fetchWithCache<BusRouteDetail>(
          key,
          `/api/transit/bus?city=${encodeURIComponent(selectedRouteCity)}&route=${encodeURIComponent(
            routeName
          )}&dir=${dir}`,
          { signal, force }
        );
        setDetail(data);
        setDetailFetchedAt(Date.now());
        setFaved(isFavorite(`bus-${data.route.city}-${data.route.routeName}`));
      } catch {
        // ignore
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedRouteCity, getCached, fetchWithCache]
  );

  useEffect(() => {
    if (!selectedRoute) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      void loadDetail(selectedRoute, direction, controller.signal);
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [selectedRoute, direction, loadDetail]);

  const handleBackgroundDetailRefresh = useCallback(() => {
    if (!selectedRoute) return;
    void loadDetail(selectedRoute, direction, undefined, true);
  }, [selectedRoute, direction, loadDetail]);

  const handleManualFrontendRefresh = useCallback(() => {
    setFrontendUpdatedAt(triggerFrontendRefresh());
  }, [triggerFrontendRefresh]);

  const handleKeypadClick = (key: string) => {
    if (key === '清除') {
      setQuery('');
    } else {
      setQuery((prev) => prev + key);
    }
  };

  const handleToggleFav = () => {
    if (!detail) return;
    const id = `bus-${detail.route.city}-${detail.route.routeName}`;
    toggleFavorite({
      id,
      mode: 'bus',
      title: `${detail.route.routeName} 公車`,
      subtitle: `${detail.route.departureStop} ⇄ ${detail.route.destinationStop}`,
      href: `/bus?city=${detail.route.city}&route=${encodeURIComponent(
        detail.route.routeName
      )}`,
    });
    setFaved(!faved);
  };

  // ==========================================
  // 檢視模式 2: 路線詳情（台北等公車預設 + 地圖切換）
  // ==========================================
  if (selectedRoute) {
    const markers: MapMarker[] = detail
      ? [
          ...detail.stops.map((s) => ({
            id: s.stopUid,
            lat: s.lat,
            lng: s.lng,
            title: `${s.sequence}. ${s.stopName}`,
            subtitle:
              s.estimateSeconds !== null
                ? s.estimateSeconds <= 45
                  ? '進站中'
                  : `約 ${Math.ceil(s.estimateSeconds / 60)} 分鐘`
                : '尚未發車',
            type: 'stop' as const,
          })),
          ...detail.vehicles.map((v) => ({
            id: `veh-${v.plateNumb}`,
            lat: v.lat,
            lng: v.lng,
            title: `公車 ${v.plateNumb}`,
            subtitle: `${v.isElectric ? '⚡ 電動公車 ' : ''}${
              v.isLowFloor ? '♿ 低地板' : ''
            }`,
            badgeText: v.plateNumb,
            type: 'bus' as const,
          })),
        ]
      : [];

    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Sticky 頂部控制列 */}
        <div className="sticky top-14 z-30 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedRoute(null);
                  setDetail(null);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="返回路線列表"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-blue-600 px-2.5 py-0.5 text-base font-bold text-white">
                    {selectedRoute}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {detail?.route.operatorName || '載入中...'}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {detail
                    ? `${detail.route.departureStop} ⇄ ${detail.route.destinationStop}`
                    : ''}
                </div>
              </div>
            </div>

            {/* 右側模式切換 & 收藏 & 刷新 */}
            <div className="flex items-center gap-2">
              {/* 雙模式切換器 (預設列表) */}
              <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    viewMode === 'list'
                      ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  列表
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    viewMode === 'map'
                      ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  地圖
                </button>
              </div>

              <button
                onClick={handleToggleFav}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                title="收藏路線"
              >
                <Star
                  className={`h-4 w-4 ${
                    faved ? 'fill-amber-400 text-amber-400' : 'text-slate-400'
                  }`}
                />
              </button>

              <AutoRefreshBadge
                intervalSeconds={30}
                onRefresh={handleBackgroundDetailRefresh}
                onManualRefresh={handleManualFrontendRefresh}
                isRefreshing={loadingDetail}
                lastUpdated={frontendUpdatedAt || detail?.updatedAt}
              />
            </div>
          </div>

          {/* 去程 / 返程 Tab */}
          {detail && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setDirection(0)}
                className={`truncate rounded-xl px-3 py-2 text-xs font-bold transition ${
                  direction === 0
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                往 {detail.route.destinationStop}
              </button>
              <button
                onClick={() => setDirection(1)}
                className={`truncate rounded-xl px-3 py-2 text-xs font-bold transition ${
                  direction === 1
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                往 {detail.route.departureStop}
              </button>
            </div>
          )}
        </div>

        {/* 內容區：台北等公車垂直列表 (預設) 或 地圖模式 */}
        {!detail ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            載入公車動態中...
          </div>
        ) : viewMode === 'map' ? (
          <div className="space-y-3">
            <LeafletMap
              polyline={detail.shape}
              polylineColor="#2563EB"
              markers={markers}
              heightClass="h-[500px]"
            />
            <p className="text-center text-xs text-slate-500">
              目前路線上有 {detail.vehicles.length} 輛公車行駛中 · 最後更新 {detail.updatedAt}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {detail.stops.map((stop, idx) => {
                const baseTs = detail.sourceUpdatedAt || detailFetchedAt;
                const offsetSec =
                  nowMs > 0 && baseTs > 0
                    ? Math.max(0, Math.floor((nowMs - baseTs) / 1000))
                    : 0;
                const badge = formatEtaBadge(stop, offsetSec);
                const isFirst = idx === 0;
                const isLast = idx === detail.stops.length - 1;

                return (
                  <li key={stop.stopUid}>
                    <button
                      type="button"
                      onClick={() => setSelectedStop(stop)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors duration-150 hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
                    >
                    {/* 左側：時間狀態膠囊 + 站序軸線 + 站名 */}
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span
                        className={`inline-flex w-20 shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold tabular-nums ${badge.className}`}
                      >
                        {badge.text}
                      </span>

                      {/* 垂直時間軸點 */}
                      <div className="relative flex flex-col items-center self-stretch">
                        {!isFirst && (
                          <div className="h-3 w-0.5 bg-slate-200 dark:bg-slate-700" />
                        )}
                        <div
                          className={`my-auto h-3 w-3 rounded-full border-2 ${
                            stop.approachingBus?.atStop
                              ? 'border-red-600 bg-red-600 ring-4 ring-red-100 dark:ring-red-950'
                              : 'border-blue-600 bg-white dark:bg-slate-900'
                          }`}
                        />
                        {!isLast && (
                          <div className="h-3 w-0.5 bg-slate-200 dark:bg-slate-700" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          <span className="mr-1.5 text-xs font-normal text-slate-400 tabular-nums">
                            {stop.sequence}.
                          </span>
                          {stop.stopName}
                        </div>
                      </div>
                    </div>

                    {/* 右側：車牌與電動/低地板標籤 */}
                    <div className="ml-2 flex shrink-0 items-center gap-1.5">
                      {stop.approachingBus && (
                        <>
                          {stop.approachingBus.isElectric && (
                            <span
                              title="電動公車"
                              className="rounded bg-emerald-50 p-1 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                            >
                              <Zap className="h-3 w-3" />
                            </span>
                          )}
                          {stop.approachingBus.isLowFloor && (
                            <span
                              title="低地板無障礙公車"
                              className="rounded bg-blue-50 p-1 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
                            >
                              <Accessibility className="h-3 w-3" />
                            </span>
                          )}
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {stop.approachingBus.plateNumb}
                          </span>
                        </>
                      )}
                      <ChevronRight className="h-4 w-4 text-[#6b7487] dark:text-[#7a8296]" strokeWidth={1.5} />
                    </div>
                  </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <DetailDrawer
          open={Boolean(selectedStop && detail)}
          onClose={() => setSelectedStop(null)}
          badge={selectedStop && detail ? `${detail.route.routeName} · 第 ${selectedStop.sequence} 站` : undefined}
          title={selectedStop?.stopName || ''}
          subtitle={detail ? `${detail.direction === 0 ? '去程' : '返程'} · ${detail.headsign}` : undefined}
        >
          {selectedStop && detail && (
            <div className="space-y-5">
              <div className="rounded-lg border border-slate-900/8 bg-[#f5f7fa] p-4 dark:border-slate-100/8 dark:bg-[#1a1e28]">
                <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">預估到站狀態</div>
                <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
                  {formatEtaBadge(
                    selectedStop,
                    nowMs > 0 && (detail.sourceUpdatedAt || detailFetchedAt) > 0
                      ? Math.max(
                          0,
                          Math.floor((nowMs - (detail.sourceUpdatedAt || detailFetchedAt)) / 1000)
                        )
                      : 0
                  ).text}
                </div>
              </div>

              {selectedStop.approachingBus && (
                <div className="rounded-lg border border-slate-900/8 p-4 dark:border-slate-100/8">
                  <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">進站車輛資訊</div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-mono text-base font-medium">
                      {selectedStop.approachingBus.plateNumb}
                    </span>
                    <span className="text-xs text-[#4b5565] dark:text-[#a3a9b8]">
                      {selectedStop.approachingBus.atStop ? '正停靠本站' : '行駛接近中'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {selectedStop.approachingBus.isLowFloor && (
                      <span className="rounded-md bg-[#eceff4] px-2 py-0.5 dark:bg-[#1a1e28]">
                        低地板無障礙公車
                      </span>
                    )}
                    {selectedStop.approachingBus.isElectric && (
                      <span className="rounded-md bg-[#eceff4] px-2 py-0.5 dark:bg-[#1a1e28]">
                        電動公車
                      </span>
                    )}
                  </div>
                </div>
              )}

              {selectedStop.lat !== 0 && selectedStop.lng !== 0 && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.lat},${selectedStop.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f4c81] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:opacity-90 dark:bg-slate-100 dark:text-[#0b0d14]"
                >
                  導航至站牌位置
                  <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                </a>
              )}
            </div>
          )}
        </DetailDrawer>
      </div>
    );
  }

  // ==========================================
  // 檢視模式 1: 公車路線搜尋與縣市選擇
  // ==========================================
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Bus className="h-6 w-6 text-blue-600" />
            公車即時查詢
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            支援垂直列表（台北等公車）與地圖雙模式即時動態
          </p>
        </div>
      </div>

      {/* 裝置位置排序狀態列 */}
      <LocationBanner
        coords={coords}
        status={locStatus}
        onRefresh={refreshLocation}
        label="已依距離您最近站牌由近到遠排序路線"
      />

      {/* 縣市選擇膠囊 */}
      <div className="flex flex-wrap gap-2">
        {BUS_CITIES.map((c) => (
          <button
            key={c.code}
            onClick={() => setCity(c.code)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              city === c.code
                ? 'bg-blue-600 text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 搜尋欄 + 專用虛擬鍵盤切換 */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="輸入公車路線編號或站名（如：307、藍1、忠孝）"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <button
            onClick={() => setShowKeypad((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              showKeypad
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <Keyboard className="h-4 w-4" />
            <span className="hidden sm:inline">公車鍵盤</span>
          </button>
        </div>

        {/* 公車專用快速輸入鍵盤 */}
        {showKeypad && (
          <div className="grid grid-cols-5 gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 p-2.5 dark:border-slate-800 dark:bg-slate-900">
            {BUS_KEYPAD.map((key) => (
              <button
                key={key}
                onClick={() => handleKeypadClick(key)}
                className={`rounded-lg py-2.5 text-sm font-bold shadow-2xs transition active:scale-95 ${
                  key === '清除'
                    ? 'col-span-2 bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                    : ['紅', '藍', '綠', '棕', '橘', '幹線', '小', '內科'].includes(key)
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 路線列表 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        {loadingList ? (
          <div className="p-8 text-center text-sm text-slate-500">搜尋路線中...</div>
        ) : routes.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            此縣市暫無符合「{query}」的路線
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {routes.map((r) => (
              <li key={r.routeUid}>
                <button
                  onClick={() => {
                    setDirection(0);
                    setSelectedRouteCity(r.city);
                    setSelectedRoute(r.routeName);
                  }}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="inline-flex min-w-[64px] items-center justify-center rounded-lg bg-blue-600 px-2.5 py-1 text-sm font-bold text-white">
                      {r.routeName}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {r.departureStop} ⇄ {r.destinationStop}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {r.operatorName}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.distanceMeters !== undefined && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums dark:bg-emerald-950/60 dark:text-emerald-300">
                        最近站 {formatDistance(r.distanceMeters)}
                      </span>
                    )}
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      看動態 →
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function BusPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">載入公車查詢中...</div>
      }
    >
      <BusPageInner />
    </Suspense>
  );
}
