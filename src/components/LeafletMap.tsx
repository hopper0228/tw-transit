'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';

export type MapMarkerType =
  | 'stop'
  | 'bus'
  | 'metro'
  | 'tra'
  | 'thsr'
  | 'youbike'
  | 'parking';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  badgeText?: string;
  color?: string;
  type?: MapMarkerType;
}

const VEHICLE_META: Record<
  'bus' | 'metro' | 'tra' | 'thsr',
  { emoji: string; defaultColor: string; fallbackLabel: string }
> = {
  bus: { emoji: '🚌', defaultColor: '#dc2626', fallbackLabel: '公車' },
  metro: { emoji: '🚇', defaultColor: '#0284c7', fallbackLabel: '捷運' },
  tra: { emoji: '🚆', defaultColor: '#4f46e5', fallbackLabel: '台鐵' },
  thsr: { emoji: '🚄', defaultColor: '#ea580c', fallbackLabel: '高鐵' },
};

function isVehicleType(t?: MapMarkerType): t is 'bus' | 'metro' | 'tra' | 'thsr' {
  return t === 'bus' || t === 'metro' || t === 'tra' || t === 'thsr';
}

function buildVehicleHtml(m: MapMarker, type: 'bus' | 'metro' | 'tra' | 'thsr'): string {
  const meta = VEHICLE_META[type];
  const bg = m.color || meta.defaultColor;
  const label = m.badgeText || meta.fallbackLabel;
  return `<div class="transit-vehicle-pill" style="background:${bg};color:#fff;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:2px solid #fff;display:inline-flex;align-items:center;gap:3px;"><span>${meta.emoji}</span><span>${label}</span></div>`;
}

interface VehicleAnimState {
  marker: L.Marker;
  from: [number, number];
  to: [number, number];
  startTime: number;
  duration: number;
  html: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface LeafletMapProps {
  center?: [number, number];
  zoom?: number;
  polyline?: [number, number][];
  polylineColor?: string;
  markers?: MapMarker[];
  focusMarkerId?: string | null;
  userCoords?: { lat: number; lng: number } | null;
  onUserLocate?: (coords: { lat: number; lng: number }) => void;
  heightClass?: string;
  onBoundsChange?: (bounds: MapBounds) => void;
}

export default function LeafletMap({
  center = [25.0468, 121.5171],
  zoom = 13,
  polyline,
  polylineColor = '#2563EB',
  markers = [],
  focusMarkerId = null,
  userCoords = null,
  onUserLocate,
  heightClass = 'h-[420px]',
  onBoundsChange,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const vehicleLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const vehicleStateRef = useRef<Map<string, VehicleAnimState>>(new Map());
  const animFrameRef = useRef<number | null>(null);
  const hasFittedBoundsRef = useRef(false);
  const lastPolylineKeyRef = useRef<string>('');
  const onBoundsChangeRef = useRef(onBoundsChange);
  const suppressNextMoveRef = useRef(false);
  const activePopupIdRef = useRef<string | null>(focusMarkerId);
  const lastFocusIdRef = useRef<string | null>(null);
  const staticMarkerByIdRef = useRef<Map<string, L.Layer>>(new Map());
  const isRebuildingLayersRef = useRef(false);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
    });

    // 使用完全免費且無 API Key 問題的標準 OpenStreetMap 圖資
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    const vehicleGroup = L.layerGroup().addTo(map);
    const userGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;
    vehicleLayerRef.current = vehicleGroup;
    userLayerRef.current = userGroup;
    hasFittedBoundsRef.current = false;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleMoveEnd = () => {
      if (suppressNextMoveRef.current) {
        suppressNextMoveRef.current = false;
        return;
      }
      if (!onBoundsChangeRef.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const b = map.getBounds();
        onBoundsChangeRef.current?.({
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
      }, 280);
    };

    map.on('moveend', handleMoveEnd);

    map.whenReady(() => {
      if (!onBoundsChangeRef.current) return;
      const b = map.getBounds();
      onBoundsChangeRef.current({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    });

    const vehicleStates = vehicleStateRef.current;

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      vehicleStates.clear();
      map.off('moveend', handleMoveEnd);
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      vehicleLayerRef.current = null;
      userLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新靜態路線與站點標記 (切換路線時才重新縮放，避免輪詢刷新拉走使用者視角)
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    const vehicleGroup = vehicleLayerRef.current;
    if (!map || !group || !vehicleGroup) return;

    const polylineKey =
      polyline && polyline.length > 1
        ? `${polyline.length}:${polyline[0][0].toFixed(4)},${polyline[0][1].toFixed(4)}:${polyline[polyline.length - 1][0].toFixed(4)}`
        : '';
    if (polylineKey && polylineKey !== lastPolylineKeyRef.current) {
      hasFittedBoundsRef.current = false;
      lastPolylineKeyRef.current = polylineKey;
    }

    if (focusMarkerId && focusMarkerId !== lastFocusIdRef.current) {
      activePopupIdRef.current = focusMarkerId;
      const target = markers.find((m) => m.id === focusMarkerId);
      if (target) {
        lastFocusIdRef.current = focusMarkerId;
        hasFittedBoundsRef.current = true;
        map.setView([target.lat, target.lng], Math.max(map.getZoom(), 16), {
          animate: false,
        });
        if (onBoundsChangeRef.current) {
          const b = map.getBounds();
          onBoundsChangeRef.current({
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          });
        }
      }
    }

    isRebuildingLayersRef.current = true;
    group.clearLayers();
    staticMarkerByIdRef.current.clear();
    isRebuildingLayersRef.current = false;

    if (polyline && polyline.length > 1) {
      const line = L.polyline(polyline, {
        color: polylineColor,
        weight: 4,
        opacity: 0.85,
      }).addTo(group);
      if (!hasFittedBoundsRef.current) {
        suppressNextMoveRef.current = true;
        map.fitBounds(line.getBounds(), { padding: [30, 30] });
        hasFittedBoundsRef.current = true;
      }
    } else if (markers.length > 0 && !hasFittedBoundsRef.current && !userCoords) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      if (bounds.isValid()) {
        suppressNextMoveRef.current = true;
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        hasFittedBoundsRef.current = true;
      }
    }

    const staticMarkers: MapMarker[] = [];
    const vehicleMarkers: MapMarker[] = [];
    for (const m of markers) {
      if (isVehicleType(m.type)) {
        vehicleMarkers.push(m);
      } else {
        staticMarkers.push(m);
      }
    }

    staticMarkers.slice(0, 120).forEach((m) => {
      const popupHtml = `<strong>${m.title}</strong>${m.subtitle ? `<br/>${m.subtitle}` : ''}`;
      let layer: L.Layer;
      if (m.type === 'youbike' || m.type === 'parking') {
        const bg = m.color || (m.type === 'youbike' ? '#ca8a04' : '#4f46e5');
        const icon = L.divIcon({
          className: 'custom-poi-marker',
          html: `<div style="background:${bg};color:#fff;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);">${m.badgeText || ''}</div>`,
          iconSize: [52, 24],
          iconAnchor: [26, 12],
        });
        layer = L.marker([m.lat, m.lng], { icon })
          .bindPopup(popupHtml, { closeOnClick: false })
          .addTo(group);
      } else {
        layer = L.circleMarker([m.lat, m.lng], {
          radius: 5.5,
          color: m.color || polylineColor,
          fillColor: '#ffffff',
          fillOpacity: 1,
          weight: 2.5,
        })
          .bindPopup(popupHtml, { closeOnClick: false })
          .addTo(group);
      }

      layer.on('popupopen', () => {
        activePopupIdRef.current = m.id;
      });
      layer.on('popupclose', () => {
        if (!isRebuildingLayersRef.current && activePopupIdRef.current === m.id) {
          activePopupIdRef.current = null;
        }
      });
      staticMarkerByIdRef.current.set(m.id, layer);
    });

    if (activePopupIdRef.current) {
      const targetLayer = staticMarkerByIdRef.current.get(activePopupIdRef.current);
      if (targetLayer && 'openPopup' in targetLayer && typeof targetLayer.openPopup === 'function') {
        targetLayer.openPopup();
      }
    }

    // 平滑更新行駛中車輛標記 (保留現有 Marker 並以 requestAnimationFrame 補間移動)
    const activeIds = new Set<string>();
    const states = vehicleStateRef.current;
    const now = performance.now();
    let needsAnimation = false;

    for (const m of vehicleMarkers.slice(0, 60)) {
      if (!isVehicleType(m.type)) continue;
      activeIds.add(m.id);
      const html = buildVehicleHtml(m, m.type);
      const popupHtml = `<strong>${m.title}</strong>${m.subtitle ? `<br/>${m.subtitle}` : ''}`;
      const existing = states.get(m.id);

      if (existing) {
        const cur = existing.marker.getLatLng();
        if (Math.abs(cur.lat - m.lat) > 1e-6 || Math.abs(cur.lng - m.lng) > 1e-6) {
          existing.from = [cur.lat, cur.lng];
          existing.to = [m.lat, m.lng];
          existing.startTime = now;
          existing.duration = m.type === 'bus' ? 2200 : 950;
          needsAnimation = true;
        }
        if (existing.html !== html) {
          existing.html = html;
          existing.marker.setIcon(
            L.divIcon({
              className: 'custom-vehicle-marker',
              html,
              iconSize: [76, 26],
              iconAnchor: [38, 13],
            })
          );
        }
        existing.marker.setPopupContent(popupHtml);
      } else {
        const icon = L.divIcon({
          className: 'custom-vehicle-marker',
          html,
          iconSize: [76, 26],
          iconAnchor: [38, 13],
        });
        const marker = L.marker([m.lat, m.lng], { icon, zIndexOffset: 600 })
          .bindPopup(popupHtml)
          .addTo(vehicleGroup);
        states.set(m.id, {
          marker,
          from: [m.lat, m.lng],
          to: [m.lat, m.lng],
          startTime: now,
          duration: 950,
          html,
        });
      }
    }

    for (const [id, st] of states.entries()) {
      if (!activeIds.has(id)) {
        vehicleGroup.removeLayer(st.marker);
        states.delete(id);
      }
    }

    if (needsAnimation) {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      const step = (ts: number) => {
        let anyActive = false;
        for (const st of states.values()) {
          const elapsed = ts - st.startTime;
          const progress = Math.min(1, Math.max(0, elapsed / st.duration));
          const lat = st.from[0] + (st.to[0] - st.from[0]) * progress;
          const lng = st.from[1] + (st.to[1] - st.from[1]) * progress;
          st.marker.setLatLng([lat, lng]);
          if (progress < 1) anyActive = true;
        }
        if (anyActive) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          animFrameRef.current = null;
        }
      };
      animFrameRef.current = requestAnimationFrame(step);
    }
  }, [polyline, polylineColor, markers, focusMarkerId]);

  const lastUserCoordsKeyRef = useRef<string>('');

  // 同步外部定位座標到地圖藍點，並在座標更新時跟隨移動視角
  useEffect(() => {
    const map = mapRef.current;
    const userGroup = userLayerRef.current;
    if (!map || !userGroup || !userCoords) return;

    const coordKey = `${userCoords.lat.toFixed(5)},${userCoords.lng.toFixed(5)}`;
    userGroup.clearLayers();
    L.circle([userCoords.lat, userCoords.lng], {
      radius: 80,
      color: '#2563EB',
      fillColor: '#3B82F6',
      fillOpacity: 0.14,
      weight: 1,
    }).addTo(userGroup);
    L.circleMarker([userCoords.lat, userCoords.lng], {
      radius: 8,
      color: '#ffffff',
      fillColor: '#2563EB',
      fillOpacity: 1,
      weight: 3,
    })
      .bindPopup('<strong>您的目前位置</strong>')
      .addTo(userGroup);

    if (lastUserCoordsKeyRef.current !== coordKey && !focusMarkerId) {
      map.setView([userCoords.lat, userCoords.lng], Math.max(map.getZoom(), 15), {
        animate: Boolean(lastUserCoordsKeyRef.current),
      });
    }
    lastUserCoordsKeyRef.current = coordKey;
  }, [userCoords, focusMarkerId]);

  // 捕捉使用者現在位置 (瀏覽器 GPS Geolocation)
  const handleLocateMe = () => {
    const map = mapRef.current;
    const userGroup = userLayerRef.current;
    if (!map || !userGroup) return;

    if (!navigator.geolocation) {
      setLocateError('您的瀏覽器不支援定位功能');
      setTimeout(() => setLocateError(null), 3500);
      return;
    }

    setLocating(true);
    setLocateError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        userGroup.clearLayers();

        // 精準度半透明藍圈
        L.circle([latitude, longitude], {
          radius: Math.min(accuracy || 80, 300),
          color: '#2563EB',
          fillColor: '#3B82F6',
          fillOpacity: 0.14,
          weight: 1,
        }).addTo(userGroup);

        // 藍色定位中心點
        L.circleMarker([latitude, longitude], {
          radius: 8,
          color: '#ffffff',
          fillColor: '#2563EB',
          fillOpacity: 1,
          weight: 3,
        })
          .bindPopup('<strong>您的目前位置</strong>')
          .addTo(userGroup)
          .openPopup();

        onUserLocate?.({ lat: latitude, lng: longitude });
        map.flyTo([latitude, longitude], 16, { duration: 0.8 });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        const msg =
          err.code === 1
            ? '請允許瀏覽器存取您的位置權限'
            : '無法取得目前位置，請稍後再試';
        setLocateError(msg);
        setTimeout(() => setLocateError(null), 4000);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${heightClass}`}
      />

      {/* 右下角：捕捉現在位置按鈕 */}
      <button
        type="button"
        onClick={handleLocateMe}
        disabled={locating}
        title="捕捉目前位置"
        className="absolute bottom-6 right-3 z-[400] flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow-md backdrop-blur-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <LocateFixed
          className={`h-4 w-4 text-blue-600 dark:text-blue-400 ${
            locating ? 'animate-spin' : ''
          }`}
        />
        <span>{locating ? '定位中...' : '我的位置'}</span>
      </button>

      {/* 定位失敗提示 */}
      {locateError && (
        <div className="absolute bottom-16 right-3 z-[400] rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-md">
          {locateError}
        </div>
      )}
    </div>
  );
}
