'use client';

import { useEffect, useRef } from 'react';
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
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
    });

    // 使用 OpenStreetMap 圖資 (免費無金鑰限制)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (polyline && polyline.length > 1) {
      const line = L.polyline(polyline, {
        color: polylineColor,
        weight: 4,
        opacity: 0.8,
      }).addTo(group);
      map.fitBounds(line.getBounds(), { padding: [30, 30] });
    } else if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }

    markers.forEach((m) => {
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
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${heightClass}`}
    />
  );
}
