import { NextRequest, NextResponse } from 'next/server';
import { MOCK_PARKING_LOTS } from '@/lib/mock-data';
import { GeoBounds, getRealTaipeiParkingLots } from '@/lib/opendata-client';

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

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const city = params.get('city') || 'All';
  const q = (params.get('q') || '').trim().toLowerCase();
  const onlyAvailable = params.get('onlyAvailable') === 'true';
  const bounds = parseBounds(params);

  if (city === 'All' || city === 'Taipei') {
    try {
      const realLots = await getRealTaipeiParkingLots(q, onlyAvailable, bounds);
      if (realLots.length > 0 || q || bounds) {
        return NextResponse.json({
          lots: realLots.slice(0, 100),
          total: realLots.length,
          updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          source: 'opendata',
        });
      }
    } catch {
      // fallback to mock
    }
  }

  const lots = MOCK_PARKING_LOTS.filter((lot) => {
    const matchCity = city === 'All' || lot.city === city;
    const matchQ =
      !q ||
      lot.name.toLowerCase().includes(q) ||
      lot.address.toLowerCase().includes(q);
    const matchAvail = !onlyAvailable || lot.availableSpaces > 0;
    const matchBounds =
      !bounds ||
      (lot.lat >= bounds.south &&
        lot.lat <= bounds.north &&
        lot.lng >= bounds.west &&
        lot.lng <= bounds.east);
    return matchCity && matchQ && matchAvail && matchBounds;
  });

  return NextResponse.json({
    lots,
    total: lots.length,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
