'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Map as MapIcon, MapPin, Search, Star, TramFront } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import type { MapMarker } from '@/components/LeafletMap';
import { useUserLocation } from '@/lib/location';
import { METRO_SYSTEMS } from '@/lib/mock-data';
import {
  findNearestMetroStation,
  getMetroStationCoord,
} from '@/lib/rail-geo';
import { MetroStationDetail } from '@/lib/types';
import { isFavorite, toggleFavorite } from '@/lib/favorites';

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[460px] w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
  ),
});

function formatCountdown(sec: number) {
  if (sec <= 30) return '進站中';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分 ${String(s).padStart(2, '0')}秒`;
}

const CROWD_COLOR: Record<1 | 2 | 3 | 4, { bg: string; label: string }> = {
  1: { bg: 'bg-emerald-500', label: '舒適' },
  2: { bg: 'bg-amber-400', label: '普通' },
  3: { bg: 'bg-orange-500', label: '略多' },
  4: { bg: 'bg-red-600', label: '擁擠' },
};

function MetroPageInner() {
  const searchParams = useSearchParams();
  const [systemId, setSystemId] = useState(
    searchParams.get('system') || 'TRTC'
  );
  const currentSys =
    METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];

  const [selectedLineCode, setSelectedLineCode] = useState(
    currentSys.lines[0].code
  );
  const currentLine =
    currentSys.lines.find((l) => l.code === selectedLineCode) ||
    currentSys.lines[0];

  const [stationId, setStationId] = useState(
    searchParams.get('station') || currentSys.lines[0].stations[11]?.id || currentSys.lines[0].stations[0].id
  );
  const [stationQuery, setStationQuery] = useState('');
  const [detail, setDetail] = useState<MetroStationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [faved, setFaved] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const { coords, ready } = useUserLocation();
  const hasAutoSelectedRef = useRef(Boolean(searchParams.get('station')));
  const [autoMatchedLabel, setAutoMatchedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !coords || hasAutoSelectedRef.current) return;
    hasAutoSelectedRef.current = true;
    const nearest = findNearestMetroStation(coords.lat, coords.lng, METRO_SYSTEMS);
    if (nearest) {
      const t = setTimeout(() => {
        setSystemId(nearest.systemId);
        setSelectedLineCode(nearest.lineCode);
        setStationId(nearest.stationId);
        setAutoMatchedLabel(`${nearest.stationId} ${nearest.stationName}站`);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [ready, coords]);

  const loadStation = useCallback(async (sys: string, st: string) => {
    try {
      const res = await fetch(
        `/api/transit/metro?system=${encodeURIComponent(sys)}&station=${encodeURIComponent(st)}`
      );
      const data: MetroStationDetail = await res.json();
      setDetail(data);
      setFaved(isFavorite(`metro-${data.systemId}-${data.stationId}`));
    } catch {
      // ignore error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      void loadStation(systemId, stationId);
    }, 0);
    return () => clearTimeout(t);
  }, [ready, systemId, stationId, loadStation]);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    void loadStation(systemId, stationId);
  }, [systemId, stationId, loadStation]);

  const handleSystemChange = (newSysId: string) => {
    hasAutoSelectedRef.current = true;
    setAutoMatchedLabel(null);
    setSystemId(newSysId);
    const sys = METRO_SYSTEMS.find((s) => s.id === newSysId) || METRO_SYSTEMS[0];
    setSelectedLineCode(sys.lines[0].code);
    setStationId(sys.lines[0].stations[0].id);
    setStationQuery('');
  };

  const handleLineChange = (code: string) => {
    hasAutoSelectedRef.current = true;
    setAutoMatchedLabel(null);
    setSelectedLineCode(code);
    const line = currentSys.lines.find((l) => l.code === code);
    if (line && line.stations[0]) {
      setStationId(line.stations[0].id);
    }
  };

  const handleToggleFav = () => {
    if (!detail) return;
    toggleFavorite({
      id: `metro-${detail.systemId}-${detail.stationId}`,
      mode: 'metro',
      title: `捷運 ${detail.stationName}站`,
      subtitle: `${detail.systemName} · ${detail.lineName}`,
      href: `/metro?system=${detail.systemId}&station=${detail.stationId}`,
    });
    setFaved(!faved);
  };

  const q = stationQuery.trim().toLowerCase();
  const visibleStations = q
    ? currentSys.lines.flatMap((l) =>
        l.stations
          .filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.id.toLowerCase().includes(q)
          )
          .map((s) => ({ ...s, lineColor: l.color, lineCode: l.code }))
      )
    : currentLine.stations.map((s) => ({
        ...s,
        lineColor: currentLine.color,
        lineCode: currentLine.code,
      }));

  const metroMapData = useMemo(() => {
    const sys = METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];
    const line = sys.lines.find((l) => l.code === selectedLineCode) || sys.lines[0];

    const stationsWithCoord = line.stations
      .map((st) => {
        const coord = getMetroStationCoord(systemId, st.id);
        return coord ? { ...st, lat: coord[0], lng: coord[1] } : null;
      })
      .filter((x): x is { id: string; name: string; lat: number; lng: number } => x !== null);

    const polyline: [number, number][] = stationsWithCoord.map((s) => [s.lat, s.lng]);

    const stopMarkers: MapMarker[] = stationsWithCoord.map((st, idx) => {
      const isSelected = st.id === stationId;
      let subtitle = `${sys.name} · ${line.name}（第 ${idx + 1}/${stationsWithCoord.length} 站）`;
      if (isSelected && detail) {
        const platSummary = detail.platforms
          .map((p) => `${p.destination}: ${formatCountdown(p.nextTrainSeconds)}`)
          .join(' | ');
        subtitle = `目前查詢站點<br/>${platSummary}`;
      }
      return {
        id: `metro-st-${st.id}`,
        lat: st.lat,
        lng: st.lng,
        title: `${st.id} ${st.name}站`,
        subtitle,
        color: isSelected ? '#dc2626' : line.color,
        type: 'stop',
      };
    });

    const vehicleMarkers: MapMarker[] = (detail?.liveVehicles || []).map((v) => ({
      id: v.id,
      lat: v.lat,
      lng: v.lng,
      title: v.title,
      subtitle: v.subtitle,
      badgeText: v.label,
      color: v.color || line.color,
      type: 'metro',
    }));

    return {
      polyline,
      markers: [...stopMarkers, ...vehicleMarkers],
      vehicleCount: vehicleMarkers.length,
    };
  }, [systemId, selectedLineCode, stationId, detail]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <TramFront className="h-6 w-6 text-teal-600" />
            捷運 / 輕軌即時查詢
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>涵蓋北捷、新北捷（環狀/輕軌）、機捷、中捷、高捷與高雄輕軌全部站點</span>
            {autoMatchedLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
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
            站點動態
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

      {/* 1. 捷運系統切換 */}
      <div className="flex flex-wrap gap-2">
        {METRO_SYSTEMS.map((sys) => (
          <button
            key={sys.id}
            onClick={() => handleSystemChange(sys.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              systemId === sys.id
                ? 'bg-teal-600 text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {sys.name}
          </button>
        ))}
      </div>

      {/* 2. 路線 Tab + 站名搜尋 + 車站選單 */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 路線選擇 Tab */}
          <div className="flex flex-wrap gap-2">
            {currentSys.lines.map((line) => {
              const active = line.code === currentLine.code && !q;
              return (
                <button
                  key={line.code}
                  onClick={() => {
                    setStationQuery('');
                    handleLineChange(line.code);
                  }}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  {line.name}
                </button>
              );
            })}
          </div>

          {/* 站名搜尋 */}
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={stationQuery}
              onChange={(e) => setStationQuery(e.target.value)}
              placeholder={`搜尋${currentSys.name}站名...`}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* 車站按鈕列表 */}
        <div className="flex flex-wrap gap-1.5">
          {visibleStations.length === 0 ? (
            <span className="text-xs text-slate-400">
              找不到符合「{stationQuery}」的車站
            </span>
          ) : (
            visibleStations.map((st) => {
              const selected = stationId === st.id;
              return (
                <button
                  key={`${st.lineCode}-${st.id}`}
                  onClick={() => setStationId(st.id)}
                  style={
                    selected
                      ? { backgroundColor: st.lineColor, borderColor: st.lineColor }
                      : undefined
                  }
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                    selected
                      ? 'text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <span className="mr-1 opacity-75">{st.id}</span>
                  {st.name}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* 3. 車站即時月台動態 */}
      {detail && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span
                className="rounded-lg px-2.5 py-1 text-sm font-bold text-white"
                style={{ backgroundColor: detail.lineColor }}
              >
                {detail.stationId}
              </span>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {detail.stationName}站
                </h2>
                <p className="text-xs text-slate-500">
                  {detail.systemName} · {detail.lineName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleFav}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 dark:border-slate-700"
              >
                <Star
                  className={`h-4 w-4 ${
                    faved ? 'fill-amber-400 text-amber-400' : 'text-slate-400'
                  }`}
                />
              </button>
              <AutoRefreshBadge
                intervalSeconds={15}
                onRefresh={handleManualRefresh}
                isRefreshing={loading}
                lastUpdated={detail.updatedAt}
              />
            </div>
          </div>

          {viewMode === 'map' ? (
            <div className="space-y-2.5">
              <LeafletMap
                polyline={metroMapData.polyline}
                polylineColor={currentLine.color}
                markers={metroMapData.markers}
                heightClass="h-[480px]"
              />
              <p className="text-center text-xs text-slate-500">
                {currentSys.name} {currentLine.name} · 地圖即時顯示 {metroMapData.vehicleCount} 列雙向行駛中列車與沿線 {metroMapData.polyline.length} 站詳細資訊
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {detail.platforms.map((plat) => (
              <div
                key={plat.platformName}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">
                    {plat.platformName}
                  </span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                    往 {plat.destination}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-slate-400">下一班車</div>
                    <div
                      className={`mt-0.5 text-2xl font-extrabold tabular-nums ${
                        plat.nextTrainSeconds <= 45
                          ? 'text-red-600 animate-pulse'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {formatCountdown(plat.nextTrainSeconds)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">下下班車</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-600 tabular-nums dark:text-slate-300">
                      {formatCountdown(plat.followingTrainSeconds)}
                    </div>
                  </div>
                </div>

                {plat.carriages && (
                  <div className="mt-5 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>車廂即時擁擠度</span>
                      <span>1車 → 6車</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                      {plat.carriages.map((c) => {
                        const info = CROWD_COLOR[c.level];
                        return (
                          <div key={c.carIndex} className="text-center">
                            <div
                              className={`h-2.5 w-full rounded-sm ${info.bg}`}
                              title={`第${c.carIndex}車廂: ${info.label}`}
                            />
                            <span className="mt-1 block text-[10px] text-slate-500">
                              {c.carIndex}·{info.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MetroPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">載入捷運資訊中...</div>
      }
    >
      <MetroPageInner />
    </Suspense>
  );
}
