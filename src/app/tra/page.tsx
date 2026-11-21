'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, List, Map as MapIcon, MapPin, TrainFront, X } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import DetailDrawer from '@/components/DetailDrawer';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
import { TRA_STATIONS } from '@/lib/mock-data';
import {
  findNearestRailStation,
  getTraStationCoord,
} from '@/lib/rail-geo';
import {
  filterByDepartureWindow,
  getDefaultTaipeiHourMinute15,
  HOURS_24,
  MINUTES_15,
  resolveTrainStopPosition,
} from '@/lib/rail-time';
import { LiveRailVehicle, TraStopTime, TraTrainRow } from '@/lib/types';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
  ),
});

const POPULAR_TRA_IDS = ['1000', '1020', '1080', '1210', '3300', '4080', '4220', '4400', '7000', '6000'];

function getTrainTypeBadge(type: TraTrainRow['trainType']) {
  switch (type) {
    case '新自強':
    case '普悠瑪':
    case '太魯閣':
      return 'bg-rose-600 text-white';
    case '自強':
      return 'bg-orange-500 text-white';
    case '莒光':
      return 'bg-amber-600 text-white';
    case '區間快':
      return 'bg-sky-600 text-white';
    default:
      return 'bg-slate-600 text-white';
  }
}

function TraPageInner() {
  const searchParams = useSearchParams();
  const [station, setStation] = useState(searchParams.get('station') || '1000');
  const [targetStation, setTargetStation] = useState(searchParams.get('to') || '');
  const [trains, setTrains] = useState<TraTrainRow[]>([]);
  const [selectedTrain, setSelectedTrain] = useState<TraTrainRow | null>(null);
  const [selectedStops, setSelectedStops] = useState<TraStopTime[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [preloadedStops, setPreloadedStops] = useState<Record<string, TraStopTime[]>>({});
  const preloadedStopsRef = useRef<Record<string, TraStopTime[]>>({});
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
  const hasAutoSelectedRef = useRef(Boolean(searchParams.get('station')));
  const [autoMatchedLabel, setAutoMatchedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !coords || hasAutoSelectedRef.current) return;
    hasAutoSelectedRef.current = true;
    const nearest = findNearestRailStation(coords.lat, coords.lng, TRA_STATIONS, 'tra');
    if (nearest) {
      const t = setTimeout(() => {
        setStation(nearest.id);
        setAutoMatchedLabel(`${nearest.name}站`);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [ready, coords]);

  const { nowMs, syncVersion, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');

  const loadTra = useCallback(
    async (signal?: AbortSignal, force = false) => {
      const boardKey = `tra:board:${station}`;
      const params = `mode=board&station=${encodeURIComponent(station)}`;
      const liveKey = 'tra:live';

      const cachedBoard = getCached<{
        trains?: TraTrainRow[];
        liveVehicles?: LiveRailVehicle[];
        updatedAt?: string;
      }>(boardKey);
      const cachedLive = getCached<{
        liveByTrain?: Record<
          string,
          {
            delayMinutes: number;
            statusText: string;
            currentStationId?: string;
            currentLocation?: string;
          }
        >;
        liveVehicles?: LiveRailVehicle[];
        updatedAt?: string;
      }>(liveKey);

      const applyLivePatch = (
        baseTrains: TraTrainRow[],
        liveMap?: Record<
          string,
          {
            delayMinutes: number;
            statusText: string;
            currentStationId?: string;
            currentLocation?: string;
          }
        >
      ) => {
        if (!liveMap || Object.keys(liveMap).length === 0) return baseTrains;
        return baseTrains.map((t) => {
          const patch = liveMap[t.trainNo];
          return patch ? { ...t, ...patch } : t;
        });
      };

      if (cachedBoard && !force) {
        setTrains(applyLivePatch(cachedBoard.data.trains || [], cachedLive?.data?.liveByTrain));
        setLiveVehicles(cachedLive?.data?.liveVehicles || cachedBoard.data.liveVehicles || []);
        setUpdatedAt(cachedLive?.data?.updatedAt || cachedBoard.data.updatedAt || '');
        setLoading(false);
      } else if (!cachedBoard) {
        setLoading(true);
      }

      try {
        const [boardData, liveData] = await Promise.all([
          fetchWithCache<{
            trains?: TraTrainRow[];
            liveVehicles?: LiveRailVehicle[];
            updatedAt?: string;
          }>(boardKey, `/api/transit/tra?${params}`, { signal }),
          fetchWithCache<{
            liveByTrain?: Record<
              string,
              {
                delayMinutes: number;
                statusText: string;
                currentStationId?: string;
                currentLocation?: string;
              }
            >;
            liveVehicles?: LiveRailVehicle[];
            updatedAt?: string;
          }>(liveKey, '/api/transit/tra?mode=live', { signal, force }),
        ]);
        setTrains(applyLivePatch(boardData.trains || [], liveData.liveByTrain));
        setLiveVehicles(liveData.liveVehicles?.length ? liveData.liveVehicles : boardData.liveVehicles || []);
        setUpdatedAt(liveData.updatedAt || boardData.updatedAt || '');
      } catch {
        // ignore abort/network error
      } finally {
        setLoading(false);
      }
    },
    [station, getCached, fetchWithCache]
  );

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      void loadTra(controller.signal);
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [loadTra, syncVersion]);

  const handleBackgroundRefresh = useCallback(() => {
    void loadTra(undefined, true);
  }, [loadTra]);

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
    const preloaded = preloadedStops[selectedTrain.trainNo];
    if (preloaded && preloaded.length > 0) {
      const t = setTimeout(() => {
        setSelectedStops(preloaded);
        setLoadingStops(false);
      }, 0);
      return () => clearTimeout(t);
    }
    const key = `tra:train:${selectedTrain.trainNo}`;
    const cached = getCached<{ fullStops?: TraStopTime[] }>(key);
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
      if (inFlightStopsRef.current.has(selectedTrain.trainNo)) return;
      void fetchWithCache<{ fullStops?: TraStopTime[] }>(
        key,
        `/api/transit/tra?mode=train&trainNo=${encodeURIComponent(selectedTrain.trainNo)}`,
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
  }, [selectedTrain, preloadedStops, getCached, fetchWithCache]);

  const filteredTrains = useMemo(() => {
    const byTarget = targetStation
      ? trains.filter((t) =>
          t.remainingStops?.some((s) => s.stationId === targetStation)
        )
      : trains;
    return filterByDepartureWindow(byTarget, customHour, customMinute);
  }, [trains, targetStation, customHour, customMinute]);

  // 畫面顯示哪些班次，就立即在背景批次預載這些班次的完整停靠站，點擊時 0ms 立即呈現
  useEffect(() => {
    const missing = Array.from(
      new Set(
        filteredTrains
          .map((t) => t.trainNo)
          .filter(
            (no) =>
              no &&
              !preloadedStopsRef.current[no] &&
              !inFlightStopsRef.current.has(no) &&
              !getCached<{ fullStops?: TraStopTime[] }>(`tra:train:${no}`)?.data?.fullStops?.length
          )
      )
    ).sort();
    if (missing.length === 0) return;

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 50) {
      chunks.push(missing.slice(i, i + 50));
    }

    const controller = new AbortController();
    for (const chunk of chunks) {
      for (const no of chunk) inFlightStopsRef.current.add(no);
      const batchKey = `tra:trains:${chunk.join(',')}`;
      void fetchWithCache<{ stopsByTrain?: Record<string, TraStopTime[]> }>(
        batchKey,
        `/api/transit/tra?mode=trains&trainNos=${encodeURIComponent(chunk.join(','))}`,
        { signal: controller.signal }
      )
        .then((res) => {
          if (res?.stopsByTrain && Object.keys(res.stopsByTrain).length > 0) {
            preloadedStopsRef.current = { ...preloadedStopsRef.current, ...res.stopsByTrain };
            setPreloadedStops((prev) => ({ ...prev, ...res.stopsByTrain }));
          }
        })
        .catch(() => {})
        .finally(() => {
          for (const no of chunk) inFlightStopsRef.current.delete(no);
        });
    }

    return () => {
      controller.abort();
      for (const no of missing) inFlightStopsRef.current.delete(no);
    };
  }, [filteredTrains, getCached, fetchWithCache]);

  const activeSelectedTrain = useMemo(
    () =>
      selectedTrain
        ? trains.find((t) => t.trainNo === selectedTrain.trainNo) ?? selectedTrain
        : null,
    [selectedTrain, trains]
  );

  const targetStationName = useMemo(
    () => TRA_STATIONS.find((s) => s.id === targetStation)?.name || '',
    [targetStation]
  );

  const traMapData = useMemo(() => {
    const stationsWithCoord = TRA_STATIONS.map((s) => {
      const coord = getTraStationCoord(s.id);
      return coord ? { ...s, lat: coord[0], lng: coord[1] } : null;
    }).filter((x): x is { id: string; name: string; lat: number; lng: number } => x !== null);

    const polyline: [number, number][] = stationsWithCoord.map((s) => [s.lat, s.lng]);

    const stopMarkers: MapMarker[] = stationsWithCoord.map((st) => {
      const isSelected = st.id === station || (Boolean(targetStation) && st.id === targetStation);
      let subtitle = `台鐵車站代碼 ${st.id}`;
      if (isSelected && filteredTrains.length > 0) {
        const preview = filteredTrains
          .slice(0, 2)
          .map((t) => `${t.trainType} ${t.trainNo} (${t.departureTime} · ${t.statusText})`)
          .join('<br/>');
        subtitle = `目前查詢重點站<br/>${preview}`;
      }
      return {
        id: `tra-st-${st.id}`,
        lat: st.lat,
        lng: st.lng,
        title: `台鐵 ${st.name}站`,
        subtitle,
        color: isSelected ? '#dc2626' : '#4f46e5',
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
      color: v.color || '#4f46e5',
      type: 'tra',
    }));

    return {
      polyline,
      markers: [...stopMarkers, ...vehicleMarkers],
      vehicleCount: vehicleMarkers.length,
    };
  }, [station, targetStation, filteredTrains, liveVehicles]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <TrainFront className="h-6 w-6 text-indigo-600" />
            台鐵火車即時查詢
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>車站即時電子看板與起訖點列車準點/誤點動態</span>
            {autoMatchedLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
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
          {/* 列表 / 地圖切換 */}
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

      {/* 條件選擇面板：出發站 + 選填目標站 (前端即時篩選) */}
      <div className="transit-card p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">出發站：</span>
                <select
                  value={station}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStation(next);
                    if (targetStation === next) setTargetStation('');
                  }}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  {TRA_STATIONS.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}車站 ({st.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">發車時間：</span>
                <select
                  value={customHour}
                  onChange={(e) => setCustomHour(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-mono text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
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
                  className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-mono text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
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

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">目標站（選填）：</span>
                <select
                  value={targetStation}
                  onChange={(e) => setTargetStation(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">全部方向（不篩選目標站）</option>
                  {TRA_STATIONS.filter((st) => st.id !== station).map((st) => (
                    <option key={st.id} value={st.id}>
                      往 {st.name}車站 ({st.id})
                    </option>
                  ))}
                </select>
                {targetStation && (
                  <button
                    type="button"
                    onClick={() => setTargetStation('')}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    title="清除目標站篩選"
                  >
                    <X className="h-3 w-3" />
                    清除
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400">熱門：</span>
            {TRA_STATIONS.filter((st) => POPULAR_TRA_IDS.includes(st.id)).map((st) => (
              <button
                key={st.id}
                onClick={() => {
                  setStation(st.id);
                  if (targetStation === st.id) setTargetStation('');
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  station === st.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {st.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 地圖模式 / 列車列表 */}
      {viewMode === 'map' ? (
        <div className="space-y-2.5">
          <LeafletMap
            polyline={traMapData.polyline}
            polylineColor="#4f46e5"
            markers={traMapData.markers}
            heightClass="h-[520px]"
          />
          <p className="text-center text-xs text-slate-500">
            台鐵環島幹線 · 地圖即時顯示 {traMapData.vehicleCount} 班行駛中列車與 {TRA_STATIONS.length} 個主要車站資訊
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            { bound: 'north' as const, title: '北上' },
            { bound: 'south' as const, title: '南下' },
          ].map((col) => {
            const list = filteredTrains.filter(
              (t) => (t.bound || (t.direction === 0 ? 'north' : 'south')) === col.bound
            );
            const nowDate = nowMs > 0 ? new Date(nowMs) : null;
            const nowMin = nowDate
              ? nowDate.getHours() * 60 +
                nowDate.getMinutes() +
                nowDate.getSeconds() / 60
              : null;
            return (
              <div
                key={col.bound}
                className="transit-card overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                  <span>{col.title}</span>
                  <span className="text-[11px] font-medium text-slate-400">
                    {list.length} 班
                  </span>
                </div>
                {list.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    {targetStation
                      ? `此方向目前無直達 ${targetStationName} 的班次`
                      : '目前無即將發車班次'}
                  </div>
                ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {list.map((t) => {
                    const [hh, mm] = t.departureTime.split(':').map(Number);
                    let estMin =
                      Number.isFinite(hh) && Number.isFinite(mm)
                        ? hh * 60 + mm + (t.delayMinutes || 0)
                        : null;
                    if (estMin !== null && nowMin !== null && hh < 3 && nowMin > 1200) {
                      estMin += 1440;
                    }
                    const diffMin =
                      estMin !== null && nowMin !== null
                        ? Math.round(estMin - nowMin)
                        : null;
                    const isDeparted =
                      (diffMin !== null && diffMin < 0) ||
                      (t.currentStationId === station &&
                        Boolean(t.currentLocation?.includes('發車') || t.currentLocation?.includes('離站')));
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
                    const targetStopInfo = targetStation
                      ? t.remainingStops?.find((s) => s.stationId === targetStation)
                      : undefined;
                    return (
                    <li
                      key={`${t.trainNo}-${t.departureTime}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTrain(t)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 ${
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
                                className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${getTrainTypeBadge(
                                  t.trainType
                                )} ${isDeparted ? 'opacity-50' : ''}`}
                              >
                                {t.trainType}
                              </span>
                              <span
                                className={`truncate text-sm font-medium ${
                                  isDeparted
                                    ? 'text-slate-400 dark:text-slate-500'
                                    : 'text-[#111827] dark:text-[#eef0f5]'
                                }`}
                              >
                                {t.trainNo} · 往 {t.destinationStation}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-xs text-[#6b7487] dark:text-[#7a8296]">
                              {targetStopInfo
                                ? `抵達 ${targetStationName} ${targetStopInfo.arrivalTime}`
                                : t.originStation
                                  ? `${t.originStation}開`
                                  : ''}
                              {etaLabel}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                              isDeparted
                                ? 'bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                : t.delayMinutes > 0
                                  ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                            }`}
                          >
                            {isDeparted ? '已發車' : t.statusText}
                          </span>
                          <ChevronRight className="h-4 w-4 text-[#6b7487] dark:text-[#7a8296]" strokeWidth={1.5} />
                        </div>
                      </button>
                    </li>
                    );
                  })}
                </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DetailDrawer
        open={Boolean(activeSelectedTrain)}
        onClose={() => setSelectedTrain(null)}
        badge={
          activeSelectedTrain
            ? `${activeSelectedTrain.trainType} ${activeSelectedTrain.trainNo}`
            : undefined
        }
        title={
          activeSelectedTrain
            ? `${activeSelectedTrain.originStation || TRA_STATIONS.find((s) => s.id === station)?.name || station} → ${activeSelectedTrain.destinationStation}`
            : ''
        }
        subtitle={
          activeSelectedTrain
            ? `${activeSelectedTrain.bound === 'north' ? '北上' : '南下'} · ${activeSelectedTrain.statusText}`
            : undefined
        }
      >
        {activeSelectedTrain && (() => {
          const stops = selectedStops;
          const originIdx = stops.findIndex((s) => s.stationId === station);

          const rawLoc = activeSelectedTrain.currentLocation || '';
          const liveAction = rawLoc.includes('進站')
            ? '進站中'
            : rawLoc.includes('到站') || rawLoc.includes('停靠')
              ? '已到站'
              : rawLoc.includes('發車') || rawLoc.includes('離站')
                ? '已發車'
                : '';

          const fallbackPos =
            !activeSelectedTrain.currentStationId && stops.length > 0
              ? resolveTrainStopPosition(stops, nowMs, activeSelectedTrain.delayMinutes)
              : null;

          const activeTrainStationId =
            activeSelectedTrain.currentStationId || fallbackPos?.stationId;
          const trainAction = liveAction || fallbackPos?.action || '';

          const liveIdx = activeTrainStationId
            ? stops.findIndex((s) => s.stationId === activeTrainStationId)
            : -1;

          // 從列車目前所在站與出發站較早者開始顯示，讓使用者在同一張表一眼看到「列車在哪」與「你在哪」
          const startIdx =
            liveIdx >= 0 && originIdx >= 0
              ? Math.min(liveIdx, originIdx)
              : Math.max(0, originIdx);
          const visibleStops = stops.slice(startIdx);

          if (loadingStops && visibleStops.length === 0) {
            return (
              <div className="rounded-lg border border-slate-900/8 p-4 text-center text-xs text-[#6b7487] dark:border-slate-100/8">
                載入停靠站時刻表中...
              </div>
            );
          }

          if (visibleStops.length === 0) {
            return (
              <div className="rounded-lg border border-slate-900/8 p-4 text-center text-xs text-[#6b7487] dark:border-slate-100/8">
                目前為即時電子看板備援資料，暫無完整停靠站表
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {activeSelectedTrain.note && (
                <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">
                  {activeSelectedTrain.note}
                </div>
              )}
              <ul className="divide-y divide-slate-900/8 rounded-lg border border-slate-900/8 dark:divide-slate-100/8 dark:border-slate-100/8">
                {visibleStops.map((st, idx) => {
                  const isOrigin = st.stationId === station;
                  const isTarget = Boolean(targetStation) && st.stationId === targetStation;
                  const isHere = Boolean(activeTrainStationId) && st.stationId === activeTrainStationId;
                  const timeLabel = isOrigin ? st.departureTime : st.arrivalTime;
                  return (
                    <li
                      key={`${st.stationId}-${idx}`}
                      className={`flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm ${
                        isOrigin || isHere ? 'bg-[#eceff4]/80 dark:bg-[#1a1e28]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{st.stationName}</span>
                        <span className="font-mono text-xs tabular-nums text-[#6b7487] dark:text-[#7a8296]">
                          {timeLabel}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isHere && (
                          <span className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white">
                            列車{trainAction ? ` · ${trainAction}` : '在此'}
                          </span>
                        )}
                        {isOrigin && (
                          <span className="rounded bg-[#0f4c81] px-2 py-0.5 text-[11px] font-medium text-white dark:bg-[#38bdf8] dark:text-[#0b0d14]">
                            你在這
                          </span>
                        )}
                        {isTarget && (
                          <span className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
                            目標站
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}
      </DetailDrawer>
    </div>
  );
}

export default function TraPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">載入台鐵資訊中...</div>
      }
    >
      <TraPageInner />
    </Suspense>
  );
}
