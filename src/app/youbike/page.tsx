'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, ExternalLink, List, Map as MapIcon, MapPin, Search } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import DetailDrawer from '@/components/DetailDrawer';
import LocationBanner from '@/components/LocationBanner';
import { formatDistance, useUserLocation } from '@/lib/location';
import { useTransitStore } from '@/lib/transit-store';
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

const DISTANCE_FILTERS = [
  { value: 500, label: '500m 內' },
  { value: 1000, label: '1km 內' },
  { value: 3000, label: '3km 內' },
  { value: 0, label: '不限距離' },
];

function YouBikePageInner() {
  const searchParams = useSearchParams();
  const {
    coords,
    ready: locReady,
    status: locStatus,
    refreshLocation,
    setManualCoords,
  } = useUserLocation();
  const { syncVersion, triggerFrontendRefresh, getCached, fetchWithCache } =
    useTransitStore();
  const [frontendUpdatedAt, setFrontendUpdatedAt] = useState('');
  const [selectedStation, setSelectedStation] = useState<YouBikeStation | null>(null);
  const [focusedStation, setFocusedStation] = useState<YouBikeStation | null>(null);

  const [maxDistance, setMaxDistance] = useState<number>(3000);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [stations, setStations] = useState<YouBikeStation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStations = useCallback(
    async (signal?: AbortSignal, force = false) => {
      const qs = new URLSearchParams({ q: query });
      if (coords) {
        qs.set('lat', String(coords.lat));
        qs.set('lng', String(coords.lng));
      }
      // 地圖模式時以地圖顯示範圍為主 (不限制裝置距離半徑，方便使用者拖曳到任何地方看)
      if (viewMode === 'map' && mapBounds) {
        qs.set('north', String(mapBounds.north));
        qs.set('south', String(mapBounds.south));
        qs.set('east', String(mapBounds.east));
        qs.set('west', String(mapBounds.west));
      } else if (coords && maxDistance > 0 && !query.trim()) {
        qs.set('maxDistance', String(maxDistance));
      }

      const key = `youbike:${qs.toString()}`;
      const cached = getCached<{
        stations?: YouBikeStation[];
        total?: number;
        updatedAt?: string;
      }>(key);

      if (cached && !force) {
        setStations(cached.data.stations || []);
        setTotalCount(cached.data.total ?? (cached.data.stations || []).length);
        setUpdatedAt(cached.data.updatedAt || '');
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const data = await fetchWithCache<{
          stations?: YouBikeStation[];
          total?: number;
          updatedAt?: string;
        }>(key, `/api/transit/youbike?${qs.toString()}`, { signal, force });
        setStations(data.stations || []);
        setTotalCount(data.total ?? (data.stations || []).length);
        setUpdatedAt(data.updatedAt || '');
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [query, coords, viewMode, mapBounds, maxDistance, getCached, fetchWithCache]
  );

  useEffect(() => {
    if (!locReady) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      void loadStations(controller.signal);
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [locReady, loadStations, syncVersion]);

  const handleBackgroundRefresh = useCallback(() => {
    void loadStations(undefined, true);
  }, [loadStations]);

  const handleManualFrontendRefresh = useCallback(() => {
    setFrontendUpdatedAt(triggerFrontendRefresh());
  }, [triggerFrontendRefresh]);

  const displayStationsForMap = useMemo(() => {
    if (!focusedStation) return stations;
    const latest = stations.find((s) => s.stationUid === focusedStation.stationUid);
    if (latest) return stations;
    return [focusedStation, ...stations];
  }, [stations, focusedStation]);

  const markers: MapMarker[] = displayStationsForMap.map((st) => {
    const totalAvail = st.availableBikes20 + st.availableBikes20E;
    return {
      id: st.stationUid,
      lat: st.lat,
      lng: st.lng,
      title: st.stationName,
      subtitle: `可借: ${totalAvail} 輛 / 可還: ${st.availableReturnDocks} 位 · 總車柱 ${st.totalDocks}<br/>${st.address} · 更新於 ${st.updatedAt}`,
      badgeText: `🚲 ${totalAvail}`,
      color: totalAvail > 0 ? '#ca8a04' : '#dc2626',
      type: 'youbike',
    };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Bike className="h-6 w-6 text-amber-600" />
            YouBike 即時查詢
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            不分縣市，依裝置位置距離與地圖顯示範圍即時呈現
          </p>
        </div>

        <div className="flex items-center gap-2">
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

      {/* 距離範圍篩選與搜尋欄 */}
      <div className="space-y-3">
        {viewMode === 'list' && coords && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">距離範圍：</span>
            {DISTANCE_FILTERS.map((d) => (
              <button
                key={d.value}
                onClick={() => setMaxDistance(d.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  maxDistance === d.value
                    ? 'bg-amber-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋站點名稱或路名（如：市政府、板橋、台北車站）"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      {viewMode === 'map' ? (
        <div className="space-y-2.5">
          {locReady ? (
            <LeafletMap
              center={
                focusedStation
                  ? [focusedStation.lat, focusedStation.lng]
                  : coords
                    ? [coords.lat, coords.lng]
                    : undefined
              }
              zoom={focusedStation ? 16 : coords ? 15 : 13}
              markers={markers}
              focusMarkerId={focusedStation?.stationUid || null}
              userCoords={coords}
              onUserLocate={(next) => {
                setFocusedStation(null);
                setManualCoords(next);
              }}
              heightClass="h-[500px]"
              onBoundsChange={(b) => setMapBounds(b)}
            />
          ) : (
            <div className="h-[500px] w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          )}
          <p className="text-center text-xs text-slate-500">
            移動或縮放地圖即自動更新該範圍站點（跨台北／新北） · 目前顯示 {stations.length} 站（共符合 {totalCount} 站）
          </p>
        </div>
      ) : stations.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          附近 {maxDistance > 0 ? `${maxDistance / 1000} km` : ''} 暫無符合站點，可切換「不限距離」或切換至「地圖」拖曳查看。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stations.map((st) => {
            const totalAvail = st.availableBikes20 + st.availableBikes20E;
            return (
              <button
                key={st.stationUid}
                type="button"
                onClick={() => {
                  setFocusedStation(st);
                  setViewMode('map');
                }}
                className="transit-card flex w-full flex-col justify-between p-4 text-left transition-colors duration-150 hover:border-slate-900/20 dark:hover:border-slate-100/20"
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
                      總車柱 {st.totalDocks} 柱
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
                      {st.city === 'Taipei' ? '台北市' : '新北市'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DetailDrawer
        open={Boolean(selectedStation)}
        onClose={() => setSelectedStation(null)}
        badge={selectedStation ? (selectedStation.city === 'Taipei' ? '台北市' : '新北市') : undefined}
        title={selectedStation?.stationName || ''}
        subtitle={selectedStation ? `${selectedStation.address} · 更新於 ${selectedStation.updatedAt}` : undefined}
      >
        {selectedStation && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-900/8 bg-[#f5f7fa] p-3.5 dark:border-slate-100/8 dark:bg-[#1a1e28]">
                <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">可借車輛合計</div>
                <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
                  {selectedStation.availableBikes20 + selectedStation.availableBikes20E}
                </div>
                <div className="mt-1 font-mono text-xs text-[#4b5565] dark:text-[#a3a9b8]">
                  2.0 一般車 {selectedStation.availableBikes20} · 2.0E 電輔車 {selectedStation.availableBikes20E}
                </div>
              </div>
              <div className="rounded-lg border border-slate-900/8 bg-[#f5f7fa] p-3.5 dark:border-slate-100/8 dark:bg-[#1a1e28]">
                <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">可還空位</div>
                <div className="mt-1 font-mono text-2xl font-medium tabular-nums">
                  {selectedStation.availableReturnDocks}
                </div>
                <div className="mt-1 font-mono text-xs text-[#4b5565] dark:text-[#a3a9b8]">
                  總車柱 {selectedStation.totalDocks} 柱
                </div>
              </div>
            </div>

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.lat},${selectedStation.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f4c81] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:opacity-90 dark:bg-slate-100 dark:text-[#0b0d14]"
            >
              開啟 Google Maps 導航
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            </a>

            <div>
              <div className="mb-2 text-xs font-medium text-[#4b5565] dark:text-[#a3a9b8]">
                鄰近替代站點
              </div>
              <ul className="divide-y divide-slate-900/8 rounded-lg border border-slate-900/8 dark:divide-slate-100/8 dark:border-slate-100/8">
                {stations
                  .filter((s) => s.stationUid !== selectedStation.stationUid)
                  .map((s) => ({
                    st: s,
                    dist:
                      Math.hypot(s.lat - selectedStation.lat, s.lng - selectedStation.lng) *
                      111000,
                  }))
                  .sort((a, b) => a.dist - b.dist)
                  .slice(0, 3)
                  .map(({ st, dist }) => (
                    <li key={st.stationUid}>
                      <button
                        type="button"
                        onClick={() => {
                  setFocusedStation(st);
                  setViewMode('map');
                }}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{st.stationName}</div>
                          <div className="font-mono text-xs text-[#6b7487]">
                            約 {Math.round(dist)} m
                          </div>
                        </div>
                        <div className="font-mono text-xs tabular-nums text-[#4b5565] dark:text-[#a3a9b8]">
                          可借 {st.availableBikes20 + st.availableBikes20E} / 空位 {st.availableReturnDocks}
                        </div>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
      </DetailDrawer>
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
