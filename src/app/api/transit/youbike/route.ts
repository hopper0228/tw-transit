import { NextRequest, NextResponse } from 'next/server';
import {
  GeoBounds,
  GeoPoint,
  getRealYouBikeStations,
} from '@/lib/opendata-client';

function parseBounds(params: URLSearchParams): GeoBounds | undefined {
  const north = Number(params.get('north'));
  const south = Number(params.get('south'));
  const east = Number(params.get('east'));
  const west = Number(params.get('west'));

  if (
    params.has('north') &&
    params.has('south') &&
    params.has('east') &&
    params.has('west') &&
    Number.isFinite(north) &&
    Number.isFinite(south) &&
    Number.isFinite(east) &&
    Number.isFinite(west)
  ) {
    return { north, south, east, west };
  }
  return undefined;
}

function parseUserPoint(params: URLSearchParams): GeoPoint | undefined {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (
    params.has('lat') &&
    params.has('lng') &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return { lat, lng };
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') || '').trim().toLowerCase();
  const bounds = parseBounds(params);
  const userPoint = parseUserPoint(params);
  const maxDistRaw = Number(params.get('maxDistance'));
  const maxDistance =
    params.has('maxDistance') && Number.isFinite(maxDistRaw) && maxDistRaw > 0
      ? maxDistRaw
      : undefined;

  try {
    const { stations, total } = await getRealYouBikeStations(
      q,
      bounds,
      userPoint,
      maxDistance,
      bounds ? 120 : 50
    );
    return NextResponse.json(
      {
        stations,
        total,
        updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
        sourceUpdatedAt: Date.now(),
        source: 'opendata',
      },
      {
        headers: {
          'Cache-Control':
            stations.length > 0
              ? 'public, s-maxage=15, stale-while-revalidate=15'
              : 'no-store, max-age=0',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        stations: [],
        total: 0,
        updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
        sourceUpdatedAt: Date.now(),
        source: 'opendata',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
