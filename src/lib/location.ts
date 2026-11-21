'use client';

import { useCallback, useEffect, useState } from 'react';

export interface GeoCoords {
  lat: number;
  lng: number;
}

const SESSION_KEY = 'tw_transit_user_coords_v1';

/**
 * 計算兩點經緯度間的直線距離 (公尺)
 */
export function getDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function useUserLocation() {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [status, setStatus] = useState<'idle' | 'locating' | 'granted' | 'denied'>('idle');
  const [ready, setReady] = useState(false);

  const setManualCoords = useCallback((next: GeoCoords) => {
    setCoords(next);
    setStatus('granted');
    setReady(true);
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ lat: next.lat, lng: next.lng, ts: Date.now() })
      );
    } catch {
      // ignore
    }
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setStatus('denied');
      setReady(true);
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: GeoCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setManualCoords(next);
      },
      () => {
        setStatus((prev) => (prev === 'granted' ? 'granted' : 'denied'));
        setReady(true);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
    );
  }, [setManualCoords]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as GeoCoords & { ts?: number };
          if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
            setCoords({ lat: parsed.lat, lng: parsed.lng });
            setStatus('granted');
            setReady(true);
            // 若暫存定位超過 60 秒，背景靜默重新校準一次最新 GPS
            if (!parsed.ts || Date.now() - parsed.ts > 60_000) {
              requestLocation();
            }
            return;
          }
        }
      } catch {
        // ignore
      }
      requestLocation();
    }, 0);
    return () => clearTimeout(timer);
  }, [requestLocation]);

  return { coords, status, ready, refreshLocation: requestLocation, setManualCoords };
}
