'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Bike, List, Map as MapIcon, MapPin, Search } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import LocationBanner from '@/components/LocationBanner';
import { formatDistance, useUserLocation } from '@/lib/location';
import { YouBikeStation } from '@/lib/types';
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

function YouBikePageInner() {
  const searchParams = useSearchParams();
  const { coords, status: locStatus, refreshLocation } = useUserLocation();

  const [city, setCity] = useState(searchParams.get('city') || 'All');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [stations, setStations] = useState<YouBikeStation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStations = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ city, q: query });
      if (coords) {
        qs.set('lat', String(coords.lat));
        qs.set('lng', String(coords.lng));
      }
      if (viewMode === 'map' && mapBounds) {
        qs.set('north', String(mapBounds.north));
        qs.set('south', String(mapBounds.south));
        qs.set('east', String(mapBounds.east));
        qs.set('west', String(mapBounds.west));
      }
      const res = await fetch(`/api/transit/youbike?${qs.toString()}`);
      const data = await res.json();
      setStations(data.stations || []);
      setTotalCount(data.total ?? (data.stations || []).length);
      setUpdatedAt(data.updatedAt || '');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [city, query, coords, viewMode, mapBounds]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadStations();
    }, 0);
    return () => clearTimeout(t);
  }, [loadStations]);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    void loadStations();
  }, [loadStations]);

  const markers: MapMarker[] = stations.map((st) => ({
    id: st.stationUid,
    lat: st.lat,
    lng: st.lng,
    title: st.stationName,
    subtitle: `可借: ${st.availableBikes20 + st.availableBikes20E} (2.0E: ${
      st.availableBikes20E
    }) / 可還: ${st.availableReturnDocks}`,
    badgeText: `🚲 ${st.availableBikes20 + st.availableBikes20E}`,
    color: st.availableBikes20 + st.availableBikes20E > 0 ? '#ca8a04' : '#dc2626',
    type: 'youbike',
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Bike className="h-6 w-6 text-amber-600" />
            YouBike 即時查詢
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            依裝置目前位置由近到遠排序，即時區分可借與可還空位
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
                  ? 'bg-white text-amber-600 shadow-xs dark:bg-slate-900 dark:text-amber-400'
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
                  ? 'bg-white text-amber-600 shadow-xs dark:bg-slate-900 dark:text-amber-400'
                  : 'text-slate-500'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              地圖
            </button>
          </div>
        </div>
      </div>

      <LocationBanner
        coords={coords}
        status={locStatus}
        onRefresh={refreshLocation}
      />

      {/* 篩選列 */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {CITIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCity(c.code)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                city === c.code
                  ? 'bg-amber-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋站點名稱或路名（如：市政府、台北車站、板橋）"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
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
            移動或縮放地圖即自動更新該範圍站點 · 目前顯示 {stations.length} 站（共符合 {totalCount} 站）
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stations.map((st) => {
            const totalAvail = st.availableBikes20 + st.availableBikes20E;
            return (
              <div
                key={st.stationUid}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {st.stationName}
                    </h3>
                    {st.distanceMeters !== undefined && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 tabular-nums dark:bg-amber-950/60 dark:text-amber-300">
                        {formatDistance(st.distanceMeters)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {st.address} · 更新於 {st.updatedAt}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div
                    className={`rounded-xl p-3 text-center ${
                      totalAvail === 0
                        ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}
                  >
                    <div className="text-[11px] font-semibold">可借車輛</div>
                    <div className="mt-0.5 text-2xl font-extrabold tabular-nums">
                      {totalAvail}
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-80">
                      2.0: {st.availableBikes20} · 電輔 2.0E: {st.availableBikes20E}
                    </div>
                  </div>

                  <div
                    className={`rounded-xl p-3 text-center ${
                      st.availableReturnDocks === 0
                        ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                        : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    }`}
                  >
                    <div className="text-[11px] font-semibold">可還空位</div>
                    <div className="mt-0.5 text-2xl font-extrabold tabular-nums">
                      {st.availableReturnDocks}
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-80">
                      總車柱 {st.totalDocks} 柱
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function YouBikePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          載入 YouBike 資訊中...
        </div>
      }
    >
      <YouBikePageInner />
    </Suspense>
  );
}
