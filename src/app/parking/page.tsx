'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  ExternalLink,
  List,
  Map as MapIcon,
  MapPin,
  ParkingCircle,
  Search,
} from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import { ParkingLot } from '@/lib/types';
import type { MapBounds, MapMarker } from '@/components/LeafletMap';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
      地圖載入中...
    </div>
  ),
});

const CITIES = [
  { code: 'All', name: '全部縣市' },
  { code: 'Taipei', name: '台北市' },
  { code: 'NewTaipei', name: '新北市' },
  { code: 'Taichung', name: '台中市' },
  { code: 'Kaohsiung', name: '高雄市' },
];

function ParkingPageInner() {
  const searchParams = useSearchParams();
  const [city, setCity] = useState(searchParams.get('city') || 'All');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [lots, setLots] = useState<ParkingLot[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);

  const loadLots = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        city,
        q: query,
        onlyAvailable: String(onlyAvailable),
      });
      if (viewMode === 'map' && mapBounds) {
        qs.set('north', String(mapBounds.north));
        qs.set('south', String(mapBounds.south));
        qs.set('east', String(mapBounds.east));
        qs.set('west', String(mapBounds.west));
      }
      const res = await fetch(`/api/transit/parking?${qs.toString()}`);
      const data = await res.json();
      setLots(data.lots || []);
      setTotalCount(data.total ?? (data.lots || []).length);
      setUpdatedAt(data.updatedAt || '');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [city, query, onlyAvailable, viewMode, mapBounds]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadLots();
    }, 0);
    return () => clearTimeout(t);
  }, [loadLots]);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    void loadLots();
  }, [loadLots]);

  const markers: MapMarker[] = lots.map((lot) => ({
    id: lot.carParkId,
    lat: lot.lat,
    lng: lot.lng,
    title: lot.name,
    subtitle: `剩餘 ${lot.availableSpaces} / ${lot.totalSpaces} 位 · ${lot.fareDescription}`,
    badgeText: lot.availableSpaces === 0 ? '已滿' : `P ${lot.availableSpaces}`,
    color:
      lot.availableSpaces === 0
        ? '#dc2626'
        : lot.availableSpaces < 15
        ? '#ea580c'
        : '#4f46e5',
    type: 'parking',
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <ParkingCircle className="h-6 w-6 text-violet-600" />
            即時停車場查詢
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            即時剩餘車位、收費標準與一鍵地圖導航
          </p>
        </div>

        <div className="flex items-center gap-2">
          <AutoRefreshBadge
            intervalSeconds={15}
            onRefresh={handleManualRefresh}
            isRefreshing={loading}
            lastUpdated={updatedAt}
          />
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === 'list'
                  ? 'bg-white text-violet-600 shadow-xs dark:bg-slate-900 dark:text-violet-400'
                  : 'text-slate-500'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              列表
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === 'map'
                  ? 'bg-white text-violet-600 shadow-xs dark:bg-slate-900 dark:text-violet-400'
                  : 'text-slate-500'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              地圖
            </button>
          </div>
        </div>
      </div>

      {/* 篩選列 */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <button
                key={c.code}
                onClick={() => setCity(c.code)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  city === c.code
                    ? 'bg-violet-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)}
              className="h-4 w-4 rounded accent-violet-600"
            />
            只顯示有空位
          </label>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋停車場名稱或路段（如：府前、台北車站、板橋）"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      {viewMode === 'map' ? (
        <div className="space-y-2.5">
          <LeafletMap
            markers={markers}
            heightClass="h-[500px]"
            onBoundsChange={(b) => setMapBounds(b)}
          />
          <p className="text-center text-xs text-slate-500">
            移動或縮放地圖即自動更新該範圍停車場 · 目前範圍顯示 {lots.length} 場（共符合 {totalCount} 場）
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lots.map((lot) => {
            const isFull = lot.availableSpaces === 0;
            const isLow = lot.availableSpaces > 0 && lot.availableSpaces < 15;
            const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`;

            return (
              <div
                key={lot.carParkId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {lot.parkingType}
                    </span>
                    <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">
                      {lot.name}
                    </h3>
                  </div>

                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {lot.address}
                  </p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    費率：{lot.fareDescription} · 更新於 {lot.updatedAt}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className={`min-w-[88px] rounded-xl px-3 py-2 text-center ${
                      isFull
                        ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        : isLow
                        ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300'
                        : 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                    }`}
                  >
                    <div className="text-[10px] font-semibold">剩餘車位</div>
                    <div className="text-xl font-extrabold tabular-nums">
                      {isFull ? '已滿' : lot.availableSpaces}
                    </div>
                    <div className="text-[10px] opacity-75">
                      共 {lot.totalSpaces} 位
                    </div>
                  </div>

                  <a
                    href={navUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                  >
                    導航
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ParkingPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          載入停車場資訊中...
        </div>
      }
    >
      <ParkingPageInner />
    </Suspense>
  );
}
