import { NextRequest, NextResponse } from 'next/server';
import { MOCK_YOUBIKE_STATIONS } from '@/lib/mock-data';
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
  const city = params.get('city') || 'All';
  const q = (params.get('q') || '').trim().toLowerCase();
  const bounds = parseBounds(params);
  const userPoint = parseUserPoint(params);

  if (city === 'All' || city === 'Taipei' || city === 'NewTaipei') {
    try {
      const realStations = await getRealYouBikeStations(
        city,
        q,
        bounds,
        userPoint
      );
      if (realStations.length > 0 || q || bounds) {
        return NextResponse.json({
          stations: realStations.slice(0, 80),
          total: realStations.length,
          updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          source: 'opendata',
        });
      }
    } catch {
      // fallback to mock
    }
  }

  const stations = MOCK_YOUBIKE_STATIONS.filter((st) => {
    const matchCity = city === 'All' || st.city === city;
    const matchQ =
      !q ||
      st.stationName.toLowerCase().includes(q) ||
      st.address.toLowerCase().includes(q);
    return matchCity && matchQ;
  });

  return NextResponse.json({
    stations,
    total: stations.length,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
