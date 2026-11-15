'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, List, Map as MapIcon, MapPin, TrainFront } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
import { TRA_STATIONS } from '@/lib/mock-data';
import {
  findNearestRailStation,
  getTraStationCoord,
} from '@/lib/rail-geo';
import { LiveRailVehicle, TraTrainRow } from '@/lib/types';

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
  const [mode, setMode] = useState<'board' | 'od'>('board');
  const [station, setStation] = useState(searchParams.get('station') || '1000');
  const [from, setFrom] = useState('1000');
  const [to, setTo] = useState('3300');
  const [trains, setTrains] = useState<TraTrainRow[]>([]);
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
        setFrom(nearest.id);
        setTo(nearest.id === '3300' ? '1000' : '3300');
        setAutoMatchedLabel(`${nearest.name}站`);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [ready, coords]);

  const { nowMs, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');

  const loadTra = useCallback(
    async (signal?: AbortSignal, force = false) => {
      const key =
        mode === 'board'
          ? `tra:board:${station}`
          : `tra:od:${from}:${to}`;
      const params =
        mode === 'board'
          ? `mode=board&station=${encodeURIComponent(station)}`
          : `mode=od&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

      const cached = getCached<{
        trains?: TraTrainRow[];
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
          trains?: TraTrainRow[];
          liveVehicles?: LiveRailVehicle[];
          updatedAt?: string;
        }>(key, `/api/transit/tra?${params}`, { signal, force });
        setTrains(data.trains || []);
        setLiveVehicles(data.liveVehicles || []);
        setUpdatedAt(data.updatedAt || '');
      } catch {
        // ignore abort/network error
      } finally {
        setLoading(false);
      }
    },
    [mode, station, from, to, getCached, fetchWithCache]
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
  }, [loadTra]);

  const handleBackgroundRefresh = useCallback(() => {
    void loadTra(undefined, true);
  }, [loadTra]);

  const handleManualFrontendRefresh = useCallback(() => {
    setFrontendUpdatedAt(triggerFrontendRefresh());
  }, [triggerFrontendRefresh]);

  const swapOd = () => {
    setFrom(to);
    setTo(from);
  };

  const traMapData = useMemo(() => {
    const stationsWithCoord = TRA_STATIONS.map((s) => {
      const coord = getTraStationCoord(s.id);
      return coord ? { ...s, lat: coord[0], lng: coord[1] } : null;
    }).filter((x): x is { id: string; name: string; lat: number; lng: number } => x !== null);

    const polyline: [number, number][] = stationsWithCoord.map((s) => [s.lat, s.lng]);

    const stopMarkers: MapMarker[] = stationsWithCoord.map((st) => {
      const isSelected =
        mode === 'board' ? st.id === station : st.id === from || st.id === to;
      let subtitle = `台鐵車站代碼 ${st.id}`;
      if (isSelected && trains.length > 0) {
        const preview = trains
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
  }, [mode, station, from, to, trains, liveVehicles]);

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

          {/* 雙分頁切換 */}
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setMode('board')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                mode === 'board'
                  ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-900 dark:text-indigo-400'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              車站即時看板
            </button>
            <button
              onClick={() => setMode('od')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                mode === 'od'
                  ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-900 dark:text-indigo-400'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              起訖點時刻表
            </button>
          </div>
        </div>
      </div>

      {/* 條件選擇面板 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        {mode === 'board' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">全部車站：</span>
                <select
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  {TRA_STATIONS.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}車站 ({st.id})
                    </option>
                  ))}
                </select>
              </div>
              <AutoRefreshBadge
                intervalSeconds={30}
                onRefresh={handleBackgroundRefresh}
                onManualRefresh={handleManualFrontendRefresh}
                isRefreshing={loading}
                lastUpdated={frontendUpdatedAt || updatedAt}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400">熱門：</span>
              {TRA_STATIONS.filter((st) => POPULAR_TRA_IDS.includes(st.id)).map((st) => (
                <button
                  key={st.id}
                  onClick={() => setStation(st.id)}
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
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
            >
              {TRA_STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  出發：{s.name}
                </option>
              ))}
            </select>
            <button
              onClick={swapOd}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              title="起訖站對調"
            >
              <ArrowLeftRight className="h-4 w-4 text-slate-600 dark:text-slate-300" />
            </button>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
            >
              {TRA_STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  抵達：{s.name}
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
        )}
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
      ) : mode === 'board' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            { dir: 0, title: '順行 (西部北上往基隆 / 東部南下)' },
            { dir: 1, title: '逆行 (西部南下往高雄 / 東部北上)' },
          ].map((col) => {
            const list = trains.filter((t) => t.direction === col.dir);
            const nowDate = nowMs > 0 ? new Date(nowMs) : null;
            const nowMin = nowDate
              ? nowDate.getHours() * 60 +
                nowDate.getMinutes() +
                nowDate.getSeconds() / 60
              : null;
            return (
              <div
                key={col.dir}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                  {col.title}
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {list.map((t) => {
                    const [hh, mm] = t.departureTime.split(':').map(Number);
                    const estMin =
                      Number.isFinite(hh) && Number.isFinite(mm)
                        ? hh * 60 + mm + (t.delayMinutes || 0)
                        : null;
                    let diffMin =
                      estMin !== null && nowMin !== null
                        ? Math.round(estMin - nowMin)
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
                    return (
                    <li
                      key={`${t.trainNo}-${t.departureTime}`}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-bold ${getTrainTypeBadge(
                            t.trainType
                          )}`}
                        >
                          {t.trainType}
                        </span>
                        <div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {t.trainNo} 次 · 往 {t.destinationStation}
                          </div>
                          <div className="text-xs text-slate-500">
                            表定 {t.departureTime} 開車{etaLabel}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          t.delayMinutes > 0
                            ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                        }`}
                      >
                        {t.statusText}
                      </span>
                    </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {trains.map((t) => (
              <li
                key={t.trainNo}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md px-2.5 py-1 text-xs font-bold ${getTrainTypeBadge(
                      t.trainType
                    )}`}
                  >
                    {t.trainType} {t.trainNo}
                  </span>
                  <div>
                    <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                      {t.departureTime} → {t.arrivalTime}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.originStation} → {t.destinationStation} · 行車約{' '}
                      {t.durationMinutes} 分鐘
                    </div>
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    t.delayMinutes > 0
                      ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                  }`}
                >
                  {t.statusText}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
