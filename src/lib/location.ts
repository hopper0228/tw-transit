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
        setCoords(next);
        setStatus('granted');
        setReady(true);
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
      },
      () => {
        setStatus('denied');
        setReady(true);
      },
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as GeoCoords;
          if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
            setCoords(parsed);
            setStatus('granted');
            setReady(true);
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

  return { coords, status, ready, refreshLocation: requestLocation };
}
