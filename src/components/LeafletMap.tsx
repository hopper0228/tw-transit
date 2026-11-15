'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  badgeText?: string;
  color?: string;
  type?: 'stop' | 'bus' | 'youbike' | 'parking';
}

interface LeafletMapProps {
  center?: [number, number];
  zoom?: number;
  polyline?: [number, number][];
  polylineColor?: string;
  markers?: MapMarker[];
  heightClass?: string;
}

type TileStyleId = 'voyager' | 'nlsc' | 'dark';

const TILE_STYLES: Record<
  TileStyleId,
  { label: string; url: string; attribution: string }
> = {
  voyager: {
    label: '現代極簡',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  nlsc: {
    label: '台灣圖資',
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '&copy; 內政部國土測繪中心',
  },
  dark: {
    label: '深色',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
};

export default function LeafletMap({
  center = [25.0468, 121.5171],
  zoom = 13,
  polyline,
  polylineColor = '#2563EB',
  markers = [],
  heightClass = 'h-[420px]',
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const [tileStyle, setTileStyle] = useState<TileStyleId>('voyager');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
    });

    const cfg = TILE_STYLES.voyager;
    const tile = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    tileLayerRef.current = tile;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切換地圖圖資風格
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_STYLES[tileStyle];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [tileStyle]);

  // 更新路線與標記 (BBox 上限保護，避免同時繪製過多 DOM 節點)
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (polyline && polyline.length > 1) {
      const line = L.polyline(polyline, {
        color: polylineColor,
        weight: 4,
        opacity: 0.85,
      }).addTo(group);
      map.fitBounds(line.getBounds(), { padding: [30, 30] });
    } else if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }

    const limitedMarkers = markers.slice(0, 120);
    limitedMarkers.forEach((m) => {
      if (m.type === 'bus') {
        const icon = L.divIcon({
          className: 'custom-bus-marker',
          html: `<div style="background:#dc2626;color:#fff;padding:3px 7px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">🚌 ${m.badgeText || '公車'}</div>`,
          iconSize: [70, 24],
          iconAnchor: [35, 12],
        });
        L.marker([m.lat, m.lng], { icon })
          .bindPopup(`<strong>${m.title}</strong><br/>${m.subtitle || ''}`)
          .addTo(group);
      } else if (m.type === 'youbike' || m.type === 'parking') {
        const bg = m.color || (m.type === 'youbike' ? '#ca8a04' : '#4f46e5');
        const icon = L.divIcon({
          className: 'custom-poi-marker',
          html: `<div style="background:${bg};color:#fff;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);">${m.badgeText || ''}</div>`,
          iconSize: [52, 24],
          iconAnchor: [26, 12],
        });
        L.marker([m.lat, m.lng], { icon })
          .bindPopup(`<strong>${m.title}</strong><br/>${m.subtitle || ''}`)
          .addTo(group);
      } else {
        L.circleMarker([m.lat, m.lng], {
          radius: 5,
          color: polylineColor,
          fillColor: '#ffffff',
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`<strong>${m.title}</strong><br/>${m.subtitle || ''}`)
          .addTo(group);
      }
    });
  }, [polyline, polylineColor, markers]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${heightClass}`}
      />

      {/* 右上角圖資風格切換器 (免費類 Google Map 風格 / 台灣官方圖資 / 深色) */}
      <div className="absolute right-3 top-3 z-[400] flex gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
        {(Object.keys(TILE_STYLES) as TileStyleId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTileStyle(id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
              tileStyle === id
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {TILE_STYLES[id].label}
          </button>
        ))}
      </div>
    </div>
  );
}
