import { NextRequest, NextResponse } from 'next/server';
import {
  METRO_SYSTEMS,
  MOCK_BUS_ROUTES,
  MOCK_PARKING_LOTS,
  MOCK_YOUBIKE_STATIONS,
  THSR_STATIONS,
  TRA_STATIONS,
} from '@/lib/mock-data';
import {
  getRealParkingLots,
  getRealYouBikeStations,
  getTaipeiBusRoutes,
} from '@/lib/opendata-client';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const results: {
    mode: 'bus' | 'metro' | 'tra' | 'thsr' | 'youbike' | 'parking';
    badge: string;
    title: string;
    subtitle: string;
    href: string;
  }[] = [];

  // 1. 優先搜尋真實雙北公車 (801+ 條路線)
  try {
    const realBus = await getTaipeiBusRoutes(q);
    for (const r of realBus.slice(0, 5)) {
      results.push({
        mode: 'bus',
        badge: '公車',
        title: `${r.routeName} (${r.cityName})`,
        subtitle: `${r.departureStop} ⇄ ${r.destinationStop}`,
        href: `/bus?city=Taipei&route=${encodeURIComponent(r.routeName)}`,
      });
    }
  } catch {
    for (const r of MOCK_BUS_ROUTES) {
      if (r.routeName.toLowerCase().includes(q)) {
        results.push({
          mode: 'bus',
          badge: '公車',
          title: `${r.routeName} (${r.cityName})`,
          subtitle: `${r.departureStop} ⇄ ${r.destinationStop}`,
          href: `/bus?city=${r.city}&route=${encodeURIComponent(r.routeName)}`,
        });
      }
    }
  }

  // 2. 捷運
  for (const sys of METRO_SYSTEMS) {
    for (const line of sys.lines) {
      for (const st of line.stations) {
        if (st.name.toLowerCase().includes(q) || st.id.toLowerCase().includes(q)) {
          results.push({
            mode: 'metro',
            badge: '捷運',
            title: `${st.name}站`,
            subtitle: `${sys.name} · ${line.name}`,
            href: `/metro?system=${sys.id}&station=${st.id}`,
          });
        }
      }
    }
  }

  // 3. 台鐵
  for (const st of TRA_STATIONS) {
    if (
      st.name.toLowerCase().includes(q) ||
      st.name.replace('臺', '台').toLowerCase().includes(q)
    ) {
      results.push({
        mode: 'tra',
        badge: '台鐵',
        title: `${st.name}車站`,
        subtitle: '台鐵即時看板 / 時刻表',
        href: `/tra?station=${st.id}`,
      });
    }
  }

  // 4. 高鐵
  for (const st of THSR_STATIONS) {
    if (st.name.toLowerCase().includes(q)) {
      results.push({
        mode: 'thsr',
        badge: '高鐵',
        title: `高鐵${st.name}站`,
        subtitle: '查詢高鐵車次與剩餘座位',
        href: `/thsr?from=${st.id}`,
      });
    }
  }

  // 5. 真實 YouBike
  try {
    const { stations: realYb } = await getRealYouBikeStations(q, undefined, undefined, undefined, 4);
    for (const yb of realYb.slice(0, 4)) {
      results.push({
        mode: 'youbike',
        badge: 'YouBike',
        title: yb.stationName,
        subtitle: `可借 ${yb.availableBikes20} · 可還 ${yb.availableReturnDocks}`,
        href: `/youbike?q=${encodeURIComponent(yb.stationName)}`,
      });
    }
  } catch {
    for (const yb of MOCK_YOUBIKE_STATIONS) {
      if (yb.stationName.toLowerCase().includes(q)) {
        results.push({
          mode: 'youbike',
          badge: 'YouBike',
          title: yb.stationName,
          subtitle: `可借 ${yb.availableBikes20 + yb.availableBikes20E} · 可還 ${yb.availableReturnDocks}`,
          href: `/youbike?q=${encodeURIComponent(yb.stationName)}`,
        });
      }
    }
  }

  // 6. 真實停車場
  try {
    const { lots: realPk } = await getRealParkingLots(q, false, undefined, undefined, undefined, 4);
    for (const pk of realPk.slice(0, 4)) {
      results.push({
        mode: 'parking',
        badge: '停車場',
        title: pk.name,
        subtitle:
          pk.availableSpaces !== null
            ? `剩餘 ${pk.availableSpaces} 位 · ${pk.address}`
            : `總車位 ${pk.totalSpaces} 格 · ${pk.address}`,
        href: `/parking?q=${encodeURIComponent(pk.name)}`,
      });
    }
  } catch {
    for (const pk of MOCK_PARKING_LOTS) {
      if (pk.name.toLowerCase().includes(q)) {
        results.push({
          mode: 'parking',
          badge: '停車場',
          title: pk.name,
          subtitle: `剩餘 ${pk.availableSpaces} 位 · ${pk.fareDescription}`,
          href: `/parking?q=${encodeURIComponent(pk.name)}`,
        });
      }
    }
  }

  return NextResponse.json({ results: results.slice(0, 15) });
}
