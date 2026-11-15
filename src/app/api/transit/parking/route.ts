import { NextRequest, NextResponse } from 'next/server';
import { MOCK_PARKING_LOTS } from '@/lib/mock-data';
import { getRealTaipeiParkingLots } from '@/lib/opendata-client';

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get('city') || 'All';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const onlyAvailable = req.nextUrl.searchParams.get('onlyAvailable') === 'true';

  if (city === 'All' || city === 'Taipei') {
    try {
      const realLots = await getRealTaipeiParkingLots(q, onlyAvailable);
      if (realLots.length > 0 || q) {
        return NextResponse.json({
          lots: realLots.slice(0, 60),
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
    return matchCity && matchQ && matchAvail;
  });

  return NextResponse.json({
    lots,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
