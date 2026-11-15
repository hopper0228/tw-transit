'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, List, Map as MapIcon, MapPin, Zap } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
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
  const [to, setTo] = useState('1040');
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
        setTo(nearest.id === '1040' ? '1070' : '1040');
        setAutoMatchedLabel(`${nearest.name}站`);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [ready, coords]);

  const loadThsr = useCallback(async () => {
    try {
      const res = await fetch(`/api/transit/thsr?from=${from}&to=${to}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      setTrains(data.trains || []);
      setLiveVehicles(data.liveVehicles || []);
      setUpdatedAt(data.updatedAt || '');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      void loadThsr();
    }, 0);
    return () => clearTimeout(t);
  }, [ready, loadThsr]);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    void loadThsr();
  }, [loadThsr]);

  const thsrMapData = useMemo(() => {
    const stationsWithCoord = THSR_STATIONS.map((s) => {
      const coord = getThsrStationCoord(s.id);
      return coord ? { ...s, lat: coord[0], lng: coord[1] } : null;
    }).filter((x): x is { id: string; name: string; lat: number; lng: number } => x !== null);

    const polyline: [number, number][] = stationsWithCoord.map((s) => [s.lat, s.lng]);

    const stopMarkers: MapMarker[] = stationsWithCoord.map((st) => {
      const isSelected = st.id === from || st.id === to;
      return {
        id: `thsr-st-${st.id}`,
        lat: st.lat,
        lng: st.lng,
        title: `高鐵 ${st.name}站`,
        subtitle:
          st.id === from
            ? '出發站 · 自由座/對號座進站中'
            : st.id === to
              ? '抵達站'
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
  }, [from, to, liveVehicles]);

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

      {/* 起訖站快速選擇器 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            {THSR_STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                出發：{s.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
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
            {THSR_STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                抵達：{s.name}
              </option>
            ))}
          </select>

          <AutoRefreshBadge
            intervalSeconds={15}
            onRefresh={handleManualRefresh}
            isRefreshing={loading}
            lastUpdated={updatedAt}
          />
        </div>
      </div>

      {/* 地圖模式 / 車次列表 */}
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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {trains.map((t) => (
            <li
              key={t.trainNo}
              className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <span className="block rounded-lg bg-orange-600 px-2.5 py-1 text-xs font-bold text-white tabular-nums">
                    {t.trainNo}
                  </span>
                  <span className="mt-1 block text-[11px] font-medium text-slate-500">
                    {t.stopPattern}
                  </span>
                </div>

                <div>
                  <div className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-white">
                    {t.departureTime} → {t.arrivalTime}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t.originStation} → {t.destinationStation} · 車程{' '}
                    {t.durationMinutes} 分鐘 · 自由座 {t.nonReservedCars}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="mb-1 text-[10px] text-slate-400">標準車廂</div>
                  {renderSeatBadge(t.standardSeatStatus)}
                </div>
                <div className="text-center">
                  <div className="mb-1 text-[10px] text-slate-400">商務車廂</div>
                  {renderSeatBadge(t.businessSeatStatus)}
                </div>
              </div>
            </li>
          ))}
        </ul>
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
