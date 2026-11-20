'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Map as MapIcon, MapPin, Zap } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
import { THSR_STATIONS } from '@/lib/mock-data';
import {
  findNearestRailStation,
  getThsrStationCoord,
} from '@/lib/rail-geo';
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

  const { nowMs, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');

  const loadThsr = useCallback(
    async (signal?: AbortSignal, force = false) => {
      const key = `thsr:board:${from}`;
      const cached = getCached<{
        trains?: ThsrTrainRow[];
        liveVehicles?: LiveRailVehicle[];
        updatedAt?: string;
      }>(key);

      if (cached && !force) {
        setTrains(cached.data.trains || []);
        setLiveVehicles(cached.data.liveVehicles || []);
        setUpdatedAt(cached.data.updatedAt || '');
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const data = await fetchWithCache<{
          trains?: ThsrTrainRow[];
          liveVehicles?: LiveRailVehicle[];
          updatedAt?: string;
        }>(
          key,
          `/api/transit/thsr?from=${encodeURIComponent(from)}`,
          { signal, force }
        );
        setTrains(data.trains || []);
        setLiveVehicles(data.liveVehicles || []);
        setUpdatedAt(data.updatedAt || '');
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
  }, [loadThsr]);

  const handleBackgroundRefresh = useCallback(() => {
    void loadThsr(undefined, true);
  }, [loadThsr]);

  const handleManualFrontendRefresh = useCallback(() => {
    setFrontendUpdatedAt(triggerFrontendRefresh());
  }, [triggerFrontendRefresh]);

  const fromName = THSR_STATIONS.find((s) => s.id === from)?.name || from;
  const targetName = THSR_STATIONS.find((s) => s.id === targetStation)?.name || '';

  // 純前端 0ms 依目標站篩選並分流為北上／南下兩欄
  const { northTrains, southTrains } = useMemo(() => {
    const filtered = targetStation
      ? trains.filter((t) =>
          t.remainingStops?.some((s) => s.stationId === targetStation)
        )
      : trains;
    return {
      northTrains: filtered.filter((t) => t.bound === 'north' || t.direction === 1),
      southTrains: filtered.filter((t) => t.bound === 'south' || t.direction === 0),
    };
  }, [trains, targetStation]);

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
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Zap className="h-6 w-6 text-orange-600" />
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

        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <List className="h-3.5 w-3.5" />
            時刻表
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === 'map'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <MapIcon className="h-3.5 w-3.5" />
            路線地圖
          </button>
        </div>
      </div>

      {/* 出發站 + 選填目標站快速篩選 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
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

          <AutoRefreshBadge
            intervalSeconds={30}
            onRefresh={handleBackgroundRefresh}
            onManualRefresh={handleManualFrontendRefresh}
            isRefreshing={loading}
            lastUpdated={frontendUpdatedAt || updatedAt}
          />
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
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"
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
                    let diffMin =
                      nowMin !== null && Number.isFinite(hh) && Number.isFinite(mm)
                        ? Math.round(hh * 60 + mm - nowMin)
                        : null;
                    if (diffMin !== null && diffMin < -720) diffMin += 1440;
                    const etaLabel =
                      diffMin === null
                        ? ''
                        : diffMin <= 0
                          ? ' · 即將/已發車'
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
                      <li
                        key={t.trainNo}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <span
                              className={`block rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums ${col.badgeClass}`}
                            >
                              {t.trainNo}
                            </span>
                            <span className="mt-1 block text-[11px] font-medium text-slate-500">
                              {t.stopPattern}
                            </span>
                          </div>

                          <div>
                            <div className="text-base font-extrabold tabular-nums text-slate-900 dark:text-white">
                              {t.departureTime} → {displayArrival}
                            </div>
                            <div className="text-xs text-slate-500">
                              {targetStop ? `抵達 ${displayDest}` : `終點 ${displayDest}`} · 約{' '}
                              {displayDur} 分 · 自由座 {t.nonReservedCars}
                              {etaLabel}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <div className="mb-0.5 text-[10px] text-slate-400">標準座</div>
                            {renderSeatBadge(stdStatus)}
                          </div>
                          <div className="text-center">
                            <div className="mb-0.5 text-[10px] text-slate-400">商務座</div>
                            {renderSeatBadge(bizStatus)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
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
