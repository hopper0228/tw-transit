import { NextRequest, NextResponse } from 'next/server';
import { MOCK_YOUBIKE_STATIONS } from '@/lib/mock-data';
import { getRealYouBikeStations } from '@/lib/opendata-client';

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get('city') || 'All';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  if (city === 'All' || city === 'Taipei' || city === 'NewTaipei') {
    try {
      const realStations = await getRealYouBikeStations(city, q);
      if (realStations.length > 0 || q) {
        return NextResponse.json({
          stations: realStations.slice(0, 60),
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
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
