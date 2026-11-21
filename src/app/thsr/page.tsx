'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, List, Map as MapIcon, MapPin, Zap } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import DetailDrawer from '@/components/DetailDrawer';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
import { THSR_STATIONS } from '@/lib/mock-data';
import {
  findNearestRailStation,
  getThsrStationCoord,
} from '@/lib/rail-geo';
import {
  filterByDepartureWindow,
  getDefaultTaipeiHourMinute15,
  HOURS_24,
  MINUTES_15,
  resolveTrainStopPosition,
} from '@/lib/rail-time';
import { LiveRailVehicle, ThsrTrainRow } from '@/lib/types';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
  ),
});

function renderSeatBadge(status: ThsrTrainRow['standardSeatStatus']) {
  if (status === 'available') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        充裕
      </span>
    );
  }
  if (status === 'limited') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        有限
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950/60 dark:text-red-300">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      已滿
    </span>
  );
}

function ThsrPageInner() {
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(searchParams.get('from') || '1000');
  const [targetStation, setTargetStation] = useState(searchParams.get('to') || '');
  const [trains, setTrains] = useState<ThsrTrainRow[]>([]);
  const [selectedTrain, setSelectedTrain] = useState<ThsrTrainRow | null>(null);
  const [selectedStops, setSelectedStops] = useState<NonNullable<ThsrTrainRow['fullStops']>>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [preloadedStops, setPreloadedStops] = useState<
    Record<string, NonNullable<ThsrTrainRow['fullStops']>>
  >({});
  const preloadedStopsRef = useRef<
    Record<string, NonNullable<ThsrTrainRow['fullStops']>>
  >({});
  const inFlightStopsRef = useRef<Set<string>>(new Set());
  const [customHour, setCustomHour] = useState<string>(
    () => getDefaultTaipeiHourMinute15().hour
  );
  const [customMinute, setCustomMinute] = useState<string>(
    () => getDefaultTaipeiHourMinute15().minute
  );
  const [liveVehicles, setLiveVehicles] = useState<LiveRailVehicle[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const { coords, ready } = useUserLocation();
  const hasAutoSelectedRef = useRef(Boolean(searchParams.get('from')));
  const [autoMatchedLabel, setAutoMatchedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !coords || hasAutoSelectedRef.current) return;
    hasAutoSelectedRef.current = true;
    const nearest = findNearestRailStation(coords.lat, coords.lng, THSR_STATIONS, 'thsr');
    if (nearest) {
      const t = setTimeout(() => {
        setFrom(nearest.id);
        setTargetStation((prev) => (prev === nearest.id ? '' : prev));
        setAutoMatchedLabel(`${nearest.name}站`);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [ready, coords]);

  const { nowMs, syncVersion, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');

  const loadThsr = useCallback(
    async (signal?: AbortSignal, force = false) => {
      const boardKey = `thsr:board:${from}`;
      const liveKey = `thsr:live:${from}`;
      const cachedBoard = getCached<{
        trains?: ThsrTrainRow[];
        liveVehicles?: LiveRailVehicle[];
        updatedAt?: string;
      }>(boardKey);
      const cachedLive = getCached<{
        seatByTrain?: Record<
          string,
          {
            standardSeatStatus: 'available' | 'limited' | 'full';
            businessSeatStatus: 'available' | 'limited' | 'full';
          }
        >;
        updatedAt?: string;
      }>(liveKey);

      const applySeatPatch = (
        baseTrains: ThsrTrainRow[],
        seatMap?: Record<
          string,
          {
            standardSeatStatus: 'available' | 'limited' | 'full';
            businessSeatStatus: 'available' | 'limited' | 'full';
          }
        >
      ) => {
        if (!seatMap || Object.keys(seatMap).length === 0) return baseTrains;
        return baseTrains.map((t) => {
          const patch = seatMap[t.trainNo];
          return patch ? { ...t, ...patch } : t;
        });
      };

      if (cachedBoard && !force) {
        setTrains(applySeatPatch(cachedBoard.data.trains || [], cachedLive?.data?.seatByTrain));
        setLiveVehicles(cachedBoard.data.liveVehicles || []);
        setUpdatedAt(cachedLive?.data?.updatedAt || cachedBoard.data.updatedAt || '');
        setLoading(false);
      } else if (!cachedBoard) {
        setLoading(true);
      }

      try {
        const [boardData, liveData] = await Promise.all([
          fetchWithCache<{
            trains?: ThsrTrainRow[];
            liveVehicles?: LiveRailVehicle[];
            updatedAt?: string;
          }>(boardKey, `/api/transit/thsr?from=${encodeURIComponent(from)}`, {
            signal,
          }),
          fetchWithCache<{
            seatByTrain?: Record<
              string,
              {
                standardSeatStatus: 'available' | 'limited' | 'full';
                businessSeatStatus: 'available' | 'limited' | 'full';
              }
            >;
            updatedAt?: string;
          }>(
            liveKey,
            `/api/transit/thsr?mode=live&from=${encodeURIComponent(from)}`,
            { signal, force }
          ),
        ]);
        setTrains(applySeatPatch(boardData.trains || [], liveData.seatByTrain));
        setLiveVehicles(boardData.liveVehicles || []);
        setUpdatedAt(liveData.updatedAt || boardData.updatedAt || '');
      } catch {
        // ignore abort/network error
      } finally {
        setLoading(false);
      }
    },
    [from, getCached, fetchWithCache]
  );

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      void loadThsr(controller.signal);
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [loadThsr, syncVersion]);

  const handleBackgroundRefresh = useCallback(() => {
    void loadThsr(undefined, true);
  }, [loadThsr]);

  const handleManualFrontendRefresh = useCallback(() => {
    setFrontendUpdatedAt(triggerFrontendRefresh());
  }, [triggerFrontendRefresh]);

  useEffect(() => {
    if (!selectedTrain) return;
    if (selectedTrain.fullStops && selectedTrain.fullStops.length > 0) {
      const t = setTimeout(() => {
        setSelectedStops(selectedTrain.fullStops || []);
        setLoadingStops(false);
      }, 0);
      return () => clearTimeout(t);
    }
    const cacheId = `${from}:${selectedTrain.trainNo}`;
    const preloaded = preloadedStops[cacheId];
    if (preloaded && preloaded.length > 0) {
      const t = setTimeout(() => {
        setSelectedStops(preloaded);
        setLoadingStops(false);
      }, 0);
      return () => clearTimeout(t);
    }
    const key = `thsr:train:${from}:${selectedTrain.trainNo}`;
    const cached = getCached<{ fullStops?: ThsrTrainRow['fullStops'] }>(key);
    if (cached?.data?.fullStops?.length) {
      const stops = cached.data.fullStops;
      const t = setTimeout(() => {
        setSelectedStops(stops);
        setLoadingStops(false);
      }, 0);
      return () => clearTimeout(t);
    }
    const controller = new AbortController();
    const startTimer = setTimeout(() => {
      setLoadingStops(true);
      setSelectedStops([]);
      if (inFlightStopsRef.current.has(cacheId)) return;
      void fetchWithCache<{ fullStops?: ThsrTrainRow['fullStops'] }>(
        key,
        `/api/transit/thsr?mode=train&from=${encodeURIComponent(from)}&trainNo=${encodeURIComponent(selectedTrain.trainNo)}`,
        { signal: controller.signal }
      )
        .then((res) => setSelectedStops(res.fullStops || []))
        .catch(() => {})
        .finally(() => setLoadingStops(false));
    }, 0);
    return () => {
      clearTimeout(startTimer);
      controller.abort();
    };
  }, [selectedTrain, from, preloadedStops, getCached, fetchWithCache]);

  const activeSelectedTrain = useMemo(
    () =>
      selectedTrain
        ? trains.find((t) => t.trainNo === selectedTrain.trainNo) ?? selectedTrain
        : null,
    [selectedTrain, trains]
  );

  const fromName = THSR_STATIONS.find((s) => s.id === from)?.name || from;
  const targetName = THSR_STATIONS.find((s) => s.id === targetStation)?.name || '';

  // 純前端 0ms 依發車時間窗 + 目標站篩選並分流為北上／南下兩欄
  const { northTrains, southTrains } = useMemo(() => {
    const byTarget = targetStation
      ? trains.filter((t) =>
          t.remainingStops?.some((s) => s.stationId === targetStation)
        )
      : trains;
    const filtered = filterByDepartureWindow(byTarget, customHour, customMinute);
    return {
      northTrains: filtered.filter((t) => t.bound === 'north' || t.direction === 1),
      southTrains: filtered.filter((t) => t.bound === 'south' || t.direction === 0),
    };
  }, [trains, targetStation, customHour, customMinute]);

  // 畫面顯示哪些班次，就立即在背景批次預載這些班次的完整停靠站與餘位，點擊時 0ms 立即呈現
  useEffect(() => {
    const visibleNos = [...northTrains, ...southTrains].map((t) => t.trainNo);
    const missing = Array.from(
      new Set(
        visibleNos.filter((no) => {
          if (!no) return false;
          const cacheId = `${from}:${no}`;
          return (
            !preloadedStopsRef.current[cacheId] &&
            !inFlightStopsRef.current.has(cacheId) &&
            !getCached<{ fullStops?: ThsrTrainRow['fullStops'] }>(`thsr:train:${from}:${no}`)
              ?.data?.fullStops?.length
          );
        })
      )
    ).sort();
    if (missing.length === 0) return;

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 50) {
      chunks.push(missing.slice(i, i + 50));
    }

    const controller = new AbortController();
    for (const chunk of chunks) {
      for (const no of chunk) inFlightStopsRef.current.add(`${from}:${no}`);
      const batchKey = `thsr:trains:${from}:${chunk.join(',')}`;
      void fetchWithCache<{
        stopsByTrain?: Record<string, NonNullable<ThsrTrainRow['fullStops']>>;
      }>(
        batchKey,
        `/api/transit/thsr?mode=trains&from=${encodeURIComponent(from)}&trainNos=${encodeURIComponent(chunk.join(','))}`,
        { signal: controller.signal }
      )
        .then((res) => {
          if (res?.stopsByTrain && Object.keys(res.stopsByTrain).length > 0) {
            const mapped: Record<string, NonNullable<ThsrTrainRow['fullStops']>> = {};
            for (const [no, stops] of Object.entries(res.stopsByTrain)) {
              mapped[`${from}:${no}`] = stops;
            }
            preloadedStopsRef.current = { ...preloadedStopsRef.current, ...mapped };
            setPreloadedStops((prev) => ({ ...prev, ...mapped }));
          }
        })
        .catch(() => {})
        .finally(() => {
          for (const no of chunk) inFlightStopsRef.current.delete(`${from}:${no}`);
        });
    }

    return () => {
      controller.abort();
      for (const no of missing) inFlightStopsRef.current.delete(`${from}:${no}`);
    };
  }, [northTrains, southTrains, from, getCached, fetchWithCache]);

  const thsrMapData = useMemo(() => {
    const stationsWithCoord = THSR_STATIONS.map((s) => {
      const coord = getThsrStationCoord(s.id);
      return coord ? { ...s, lat: coord[0], lng: coord[1] } : null;
    }).filter((x): x is { id: string; name: string; lat: number; lng: number } => x !== null);

    const polyline: [number, number][] = stationsWithCoord.map((s) => [s.lat, s.lng]);

    const stopMarkers: MapMarker[] = stationsWithCoord.map((st) => {
      const isSelected = st.id === from || (Boolean(targetStation) && st.id === targetStation);
      return {
        id: `thsr-st-${st.id}`,
        lat: st.lat,
        lng: st.lng,
        title: `高鐵 ${st.name}站`,
        subtitle:
          st.id === from
            ? '出發站 · 顯示北上與南下即時班次'
            : targetStation && st.id === targetStation
              ? '目標篩選站'
              : `高鐵車站代碼 ${st.id}`,
        color: isSelected ? '#dc2626' : '#ea580c',
        type: 'stop',
      };
    });

    const vehicleMarkers: MapMarker[] = liveVehicles.map((v) => ({
      id: v.id,
      lat: v.lat,
      lng: v.lng,
      title: v.title,
      subtitle: v.subtitle,
      badgeText: v.label,
      color: v.color || '#ea580c',
      type: 'thsr',
    }));

    return {
      polyline,
      markers: [...stopMarkers, ...vehicleMarkers],
      vehicleCount: vehicleMarkers.length,
    };
  }, [from, targetStation, liveVehicles]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight text-[#111827] dark:text-[#eef0f5]">
            <Zap className="h-5 w-5 text-[#4b5565] dark:text-[#a3a9b8]" strokeWidth={1.5} />
            台灣高鐵即時查詢
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>車次時刻、停靠模式與即時剩餘座位燈號</span>
            {autoMatchedLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                <MapPin className="h-3 w-3" />
                已依定位預設最近：{autoMatchedLabel}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AutoRefreshBadge
            intervalSeconds={30}
            onRefresh={handleBackgroundRefresh}
            onManualRefresh={handleManualFrontendRefresh}
            isRefreshing={loading}
            lastUpdated={frontendUpdatedAt || updatedAt}
          />
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              列表
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === 'map'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              地圖
            </button>
          </div>
        </div>
      </div>

      {/* 出發站 + 選填目標站快速篩選 */}
      <div className="transit-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={from}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setFrom(nextFrom);
              if (targetStation === nextFrom) setTargetStation('');
            }}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            {THSR_STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                出發：{s.name}
              </option>
            ))}
          </select>

          <select
            value={targetStation}
            onChange={(e) => setTargetStation(e.target.value)}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">目標站（選填，全部北上 / 南下）</option>
            {THSR_STATIONS.filter((s) => s.id !== from).map((s) => (
              <option key={s.id} value={s.id}>
                目標：{s.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">發車時間：</span>
            <select
              value={customHour}
              onChange={(e) => setCustomHour(e.target.value)}
              className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2.5 font-mono text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
              aria-label="選擇發車小時"
            >
              {HOURS_24.map((h) => (
                <option key={h} value={h}>
                  {h} 時
                </option>
              ))}
            </select>
            <select
              value={customMinute}
              onChange={(e) => setCustomMinute(e.target.value)}
              className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2.5 font-mono text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
              aria-label="選擇發車分鐘"
            >
              {MINUTES_15.map((m) => (
                <option key={m} value={m}>
                  {m} 分
                </option>
              ))}
            </select>
            <span className="text-xs text-[#6b7487] dark:text-[#7a8296]">後 1 小時</span>
          </div>
        </div>
      </div>

      {/* 地圖模式 / 北上・南下雙欄車次 */}
      {viewMode === 'map' ? (
        <div className="space-y-2.5">
          <LeafletMap
            polyline={thsrMapData.polyline}
            polylineColor="#ea580c"
            markers={thsrMapData.markers}
            heightClass="h-[520px]"
          />
          <p className="text-center text-xs text-slate-500">
            台灣高鐵西部幹線 · 地圖即時顯示 {thsrMapData.vehicleCount} 班行駛中列車與全線 {THSR_STATIONS.length} 站資訊
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            {
              key: 'north',
              title: '北上列車',
              hint: '往台北・南港方向',
              badgeClass: 'bg-sky-600 text-white',
              headerClass: 'border-sky-100 bg-sky-50/70 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200',
              list: northTrains,
            },
            {
              key: 'south',
              title: '南下列車',
              hint: '往台中・左營方向',
              badgeClass: 'bg-orange-600 text-white',
              headerClass: 'border-orange-100 bg-orange-50/70 text-orange-900 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-200',
              list: southTrains,
            },
          ].map((col) => (
            <div
              key={col.key}
              className="transit-card overflow-hidden"
            >
              <div
                className={`flex items-center justify-between border-b px-4 py-3 ${col.headerClass}`}
              >
                <div>
                  <h2 className="text-sm font-bold">{col.title}</h2>
                  <p className="text-[11px] opacity-75">
                    {fromName}出發 · {col.hint}
                  </p>
                </div>
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-bold tabular-nums text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
                  {col.list.length} 班
                </span>
              </div>

              {col.list.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-400">
                  {targetStation
                    ? `無從 ${fromName} 經 ${targetName} 之${col.title}`
                    : `此站無${col.title}發車班次`}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {col.list.map((t) => {
                    const nowDate = nowMs > 0 ? new Date(nowMs) : null;
                    const nowMin = nowDate
                      ? nowDate.getHours() * 60 +
                        nowDate.getMinutes() +
                        nowDate.getSeconds() / 60
                      : null;
                    const [hh, mm] = t.departureTime.split(':').map(Number);
                    let depMin =
                      Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
                    if (depMin !== null && nowMin !== null && hh < 3 && nowMin > 1200) {
                      depMin += 1440;
                    }
                    const diffMin =
                      depMin !== null && nowMin !== null
                        ? Math.round(depMin - nowMin)
                        : null;
                    const isDeparted = diffMin !== null && diffMin < 0;
                    const etaLabel =
                      isDeparted
                        ? ' · 已發車'
                        : diffMin === null
                          ? ''
                          : diffMin === 0
                            ? ' · 即將發車'
                            : diffMin <= 60
                              ? ` · 約 ${diffMin} 分後`
                              : '';

                    const targetStop = targetStation
                      ? t.remainingStops?.find((s) => s.stationId === targetStation)
                      : undefined;
                    const displayArrival = targetStop?.arrivalTime || t.arrivalTime;
                    const displayDest = targetStop ? targetName : t.destinationStation;
                    const stdStatus = targetStop?.standardSeatStatus ?? t.standardSeatStatus;
                    const bizStatus = targetStop?.businessSeatStatus ?? t.businessSeatStatus;

                    let displayDur = t.durationMinutes;
                    if (targetStop) {
                      const [ah, am] = targetStop.arrivalTime.split(':').map(Number);
                      if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ah) && Number.isFinite(am)) {
                        displayDur = ah * 60 + am - (hh * 60 + mm);
                        if (displayDur < 0) displayDur += 1440;
                      }
                    }

                    return (
                      <li key={t.trainNo}>
                        <button
                          type="button"
                          onClick={() => setSelectedTrain(t)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors duration-150 ${
                            isDeparted
                              ? 'bg-slate-100/80 text-slate-400 hover:bg-slate-100 dark:bg-slate-800/40 dark:text-slate-500 dark:hover:bg-slate-800/60'
                              : 'hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]'
                          }`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <span
                              className={`w-14 shrink-0 font-mono text-xl font-medium tabular-nums ${
                                isDeparted
                                  ? 'text-slate-400 line-through dark:text-slate-500'
                                  : 'text-[#111827] dark:text-[#eef0f5]'
                              }`}
                            >
                              {t.departureTime}
                            </span>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums ${col.badgeClass} ${
                                    isDeparted ? 'opacity-50' : ''
                                  }`}
                                >
                                  {t.trainNo}
                                </span>
                                <span
                                  className={`truncate text-sm font-medium ${
                                    isDeparted
                                      ? 'text-slate-400 dark:text-slate-500'
                                      : 'text-[#111827] dark:text-[#eef0f5]'
                                  }`}
                                >
                                  {targetStop ? `往 ${displayDest}` : `終點 ${displayDest}`} · {displayArrival} 抵
                                </span>
                              </div>
                              <div className="mt-0.5 truncate font-mono text-xs text-[#6b7487] dark:text-[#7a8296]">
                                {t.stopPattern} · 約 {displayDur} 分 · 自由座 {t.nonReservedCars}
                                {etaLabel}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2.5">
                            {isDeparted ? (
                              <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                已發車
                              </span>
                            ) : (
                              <>
                                <div className="text-center">
                                  <div className="mb-0.5 text-[10px] text-[#6b7487]">標準</div>
                                  {renderSeatBadge(stdStatus)}
                                </div>
                                <div className="text-center">
                                  <div className="mb-0.5 text-[10px] text-[#6b7487]">商務</div>
                                  {renderSeatBadge(bizStatus)}
                                </div>
                              </>
                            )}
                            <ChevronRight className="h-4 w-4 text-[#6b7487] dark:text-[#7a8296]" strokeWidth={1.5} />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <DetailDrawer
        open={Boolean(activeSelectedTrain)}
        onClose={() => setSelectedTrain(null)}
        badge={activeSelectedTrain ? `高鐵 ${activeSelectedTrain.trainNo}` : undefined}
        title={
          activeSelectedTrain
            ? `${activeSelectedTrain.originStation || fromName} → ${activeSelectedTrain.destinationStation}`
            : ''
        }
        subtitle={
          activeSelectedTrain
            ? `${activeSelectedTrain.bound === 'north' ? '北上' : '南下'} · ${activeSelectedTrain.stopPattern} · 自由座 ${activeSelectedTrain.nonReservedCars}`
            : undefined
        }
      >
        {activeSelectedTrain && (() => {
          const stops = selectedStops;
          const originIdx = stops.findIndex((s) => s.stationId === from);
          const trainPos = resolveTrainStopPosition(stops, nowMs, 0);
          const liveIdx = trainPos
            ? stops.findIndex((s) => s.stationId === trainPos.stationId)
            : -1;
          const startIdx =
            liveIdx >= 0 && originIdx >= 0
              ? Math.min(liveIdx, originIdx)
              : Math.max(0, originIdx);
          const visibleStops = stops.slice(startIdx);

          const posStationName = trainPos
            ? stops.find((s) => s.stationId === trainPos.stationId)?.stationName ||
              THSR_STATIONS.find((s) => s.id === trainPos.stationId)?.name ||
              trainPos.stationId
            : '';
          const summaryLocationText = trainPos
            ? `${posStationName}（${trainPos.action}）`
            : `${activeSelectedTrain.originStation || fromName}（預計 ${activeSelectedTrain.departureTime} 發車）`;

          const locationBanner = (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-50 px-3.5 py-2.5 text-xs dark:border-amber-400/25 dark:bg-amber-950/30">
              <span className="font-medium text-amber-800 dark:text-amber-300">
                列車目前位置
              </span>
              <span className="font-bold text-amber-900 dark:text-amber-200">
                {summaryLocationText}
              </span>
            </div>
          );

          if (loadingStops && visibleStops.length === 0) {
            return (
              <div className="space-y-3">
                {locationBanner}
                <div className="rounded-lg border border-slate-900/8 p-4 text-center text-xs text-[#6b7487] dark:border-slate-100/8">
                  載入停靠站與餘位中...
                </div>
              </div>
            );
          }
          if (visibleStops.length === 0) {
            return locationBanner;
          }

          return (
            <div className="space-y-3">
              {locationBanner}
              <div className="overflow-hidden rounded-lg border border-slate-900/8 dark:border-slate-100/8">
              <div className="grid grid-cols-12 border-b border-slate-900/8 bg-[#f5f7fa] px-3.5 py-2 text-[11px] font-medium text-[#6b7487] dark:border-slate-100/8 dark:bg-[#1a1e28] dark:text-[#7a8296]">
                <span className="col-span-6">停靠站與位置</span>
                <span className="col-span-2 text-right">時間</span>
                <span className="col-span-4 text-right">標準 / 商務</span>
              </div>
              <ul className="divide-y divide-slate-900/8 dark:divide-slate-100/8">
                {visibleStops.map((st, idx) => {
                  const isOrigin = st.stationId === from;
                  const isTarget = Boolean(targetStation) && st.stationId === targetStation;
                  const isHere = Boolean(trainPos) && st.stationId === trainPos?.stationId;
                  const timeLabel = isOrigin ? st.departureTime : st.arrivalTime;
                  return (
                    <li
                      key={`${st.stationId}-${idx}`}
                      className={`grid grid-cols-12 items-center gap-1 px-3.5 py-2.5 text-sm ${
                        isOrigin || isHere ? 'bg-[#eceff4]/80 dark:bg-[#1a1e28]' : ''
                      }`}
                    >
                      <div className="col-span-6 flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-medium">{st.stationName}</span>
                        {isHere && trainPos && (
                          <span className="shrink-0 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            列車 · {trainPos.action}
                          </span>
                        )}
                        {isOrigin && (
                          <span className="shrink-0 rounded bg-[#0f4c81] px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-[#38bdf8] dark:text-[#0b0d14]">
                            你在這
                          </span>
                        )}
                        {isTarget && (
                          <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            目標站
                          </span>
                        )}
                      </div>
                      <span className="col-span-2 text-right font-mono text-xs tabular-nums text-[#111827] dark:text-[#eef0f5]">
                        {timeLabel}
                      </span>
                      <div className="col-span-4 flex items-center justify-end gap-1.5">
                        {st.standardSeatStatus && st.businessSeatStatus ? (
                          <>
                            {renderSeatBadge(st.standardSeatStatus)}
                            {renderSeatBadge(st.businessSeatStatus)}
                          </>
                        ) : (
                          <span className="text-xs text-[#6b7487]">—</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              </div>
            </div>
          );
        })()}
      </DetailDrawer>
    </div>
  );
}

export default function ThsrPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">載入高鐵資訊中...</div>
      }
    >
      <ThsrPageInner />
    </Suspense>
  );
}
