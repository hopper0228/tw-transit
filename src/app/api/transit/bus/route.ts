import { NextRequest, NextResponse } from 'next/server';
import {
  GeoPoint,
  getTaipeiBusRouteDetail,
  getTaipeiBusRoutes,
} from '@/lib/opendata-client';
import { fetchTdx, isTdxConfigured } from '@/lib/tdx-client';
import { BusRouteDetail, BusStopStatus } from '@/lib/types';

const NO_STORE_HEADERS = { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' };

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
  const city = params.get('city') || 'Taipei';
  const routeName = params.get('route');
  const direction = (Number(params.get('dir')) === 1 ? 1 : 0) as 0 | 1;
  const q = (params.get('q') || '').trim().toLowerCase();
  const userPoint = parseUserPoint(params);

  // 1. 若無指定 route：回傳路線列表供搜尋
  if (!routeName) {
    // 雙北公車若需依裝置距離排序，使用已建立站牌座標索引的 OpenData 計算精準距離
    if ((city === 'Taipei' || city === 'All') && userPoint) {
      try {
        const realRoutes = await getTaipeiBusRoutes(q, userPoint);
        return NextResponse.json({
          routes: realRoutes.slice(0, 60),
          total: realRoutes.length,
          source: isTdxConfigured() ? 'tdx' : 'opendata',
        });
      } catch {
        // fallback below
      }
    }

    // 優先使用 TDX (若已設定金鑰)
    if (isTdxConfigured() && city !== 'InterCity') {
      try {
        const tdxRoutes = await fetchTdx<
          {
            RouteUID: string;
            RouteName: { Zh_tw: string };
            DepartureStopNameZh?: string;
            DestinationStopNameZh?: string;
            Operators?: { OperatorName: { Zh_tw: string } }[];
          }[]
        >(`/v2/Bus/Route/City/${city}?$top=80&$format=JSON`, 3600);

        const mapped = tdxRoutes
          .filter((r) => !q || r.RouteName.Zh_tw.toLowerCase().includes(q))
          .slice(0, 60)
          .map((r) => ({
            routeUid: r.RouteUID,
            routeName: r.RouteName.Zh_tw,
            city,
            cityName: city,
            departureStop: r.DepartureStopNameZh || '起站',
            destinationStop: r.DestinationStopNameZh || '迄站',
            operatorName: r.Operators?.[0]?.OperatorName?.Zh_tw || '客運業者',
          }));
        return NextResponse.json({ routes: mapped, source: 'tdx' });
      } catch {
        // fallback below
      }
    }

    // 雙北公車使用免帳號真實台北市 OpenData (801+ 條路線，依裝置距離排序)
    if (city === 'Taipei' || city === 'All') {
      try {
        const realRoutes = await getTaipeiBusRoutes(q, userPoint);
        return NextResponse.json({
          routes: realRoutes.slice(0, 60),
          total: realRoutes.length,
          source: 'opendata',
        });
      } catch {
        // fallback to mock if network fails
      }
    }

    return NextResponse.json(
      { routes: [], total: 0, source: 'tdx' },
      { headers: NO_STORE_HEADERS }
    );
  }

  // 2. 台北市公車優先使用免配額政府即時 OpenData (含站序、預估到站與即時公車座標)，節省 TDX 額度
  if (city === 'Taipei' || city === 'All') {
    try {
      const realDetail = await getTaipeiBusRouteDetail(routeName, direction);
      if (realDetail) {
        return NextResponse.json(realDetail, { headers: NO_STORE_HEADERS });
      }
    } catch {
      // fallback to TDX below
    }
  }

  // 3. 其他縣市 (新北/桃園/台中/台南/高雄等) 使用 TDX 即時站序、到站時間與行駛中車輛
  if (isTdxConfigured() && city !== 'InterCity' && city !== 'All') {
    try {
      const encodedRoute = encodeURIComponent(routeName);
      const [stopOfRoutes, etas, liveBuses] = await Promise.all([
        fetchTdx<
          {
            RouteName: { Zh_tw: string };
            Direction: number;
            Stops: {
              StopUID: string;
              StopName: { Zh_tw: string };
              StopSequence: number;
              StopPosition: { PositionLat: number; PositionLon: number };
            }[];
          }[]
        >(`/v2/Bus/StopOfRoute/City/${city}/${encodedRoute}?%24format=JSON`, 3600),
        fetchTdx<
          {
            RouteName?: { Zh_tw?: string };
            StopUID: string;
            Direction: number;
            EstimateTime?: number;
            StopStatus: number;
            PlateNumb?: string;
          }[]
        >(`/v2/Bus/EstimatedTimeOfArrival/City/${city}/${encodedRoute}?%24format=JSON`, 15).catch(
          () => []
        ),
        fetchTdx<
          {
            PlateNumb: string;
            RouteName?: { Zh_tw?: string };
            Direction: number;
            BusPosition?: { PositionLat: number; PositionLon: number };
            Azimuth?: number;
          }[]
        >(`/v2/Bus/RealTimeByFrequency/City/${city}/${encodedRoute}?%24format=JSON`, 15).catch(
          () => []
        ),
      ]);

      const exactStops = (Array.isArray(stopOfRoutes) ? stopOfRoutes : []).filter(
        (r) => r.RouteName?.Zh_tw === routeName
      );
      const dirRoute =
        exactStops.find((r) => r.Direction === direction) || exactStops[0];

      if (dirRoute) {
        const etaMap = new Map(
          (Array.isArray(etas) ? etas : [])
            .filter(
              (e) =>
                (!e.RouteName?.Zh_tw || e.RouteName.Zh_tw === routeName) &&
                e.Direction === direction
            )
            .map((e) => [e.StopUID, e])
        );

        const vehicles = (Array.isArray(liveBuses) ? liveBuses : [])
          .filter(
            (b) =>
              (!b.RouteName?.Zh_tw || b.RouteName.Zh_tw === routeName) &&
              b.Direction === direction &&
              b.BusPosition &&
              Number.isFinite(b.BusPosition.PositionLat) &&
              Number.isFinite(b.BusPosition.PositionLon)
          )
          .map((b) => ({
            plateNumb: b.PlateNumb,
            lat: b.BusPosition!.PositionLat,
            lng: b.BusPosition!.PositionLon,
            azimuth: b.Azimuth ?? 0,
            isLowFloor: true,
            isElectric: false,
            nearStopSeq: 0,
          }));

        const stops: BusStopStatus[] = dirRoute.Stops.map((s) => {
          const eta = etaMap.get(s.StopUID);
          const estSec = eta?.EstimateTime ?? null;
          return {
            stopUid: s.StopUID,
            stopName: s.StopName.Zh_tw,
            sequence: s.StopSequence,
            lat: s.StopPosition.PositionLat,
            lng: s.StopPosition.PositionLon,
            estimateSeconds: estSec,
            stopStatus: (eta?.StopStatus ?? 1) as BusStopStatus['stopStatus'],
            approachingBus:
              estSec !== null && estSec <= 180 && eta?.PlateNumb
                ? {
                    plateNumb: eta.PlateNumb,
                    isLowFloor: true,
                    isElectric: false,
                    atStop: estSec <= 35,
                  }
                : undefined,
          };
        });

        const detail: BusRouteDetail = {
          route: {
            routeUid: `${city}-${routeName}`,
            routeName,
            city,
            cityName: city,
            departureStop: stops[0]?.stopName || '起站',
            destinationStop: stops[stops.length - 1]?.stopName || '迄站',
            operatorName: 'TDX 即時連線',
          },
          direction,
          headsign: `往 ${stops[stops.length - 1]?.stopName || '終點'}`,
          stops,
          shape: stops.map((s) => [s.lat, s.lng]),
          vehicles,
          updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          sourceUpdatedAt: Date.now(),
          source: 'tdx',
        };

        return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
      }
    } catch {
      // fallback to OpenData below
    }
  }

  // 雙北公車使用免帳號真實台北市 OpenData 即時動態
  if (city === 'Taipei' || city === 'NewTaipei' || city === 'All') {
    try {
      const realDetail = await getTaipeiBusRouteDetail(routeName, direction);
      if (realDetail) {
        return NextResponse.json(realDetail, { headers: NO_STORE_HEADERS });
      }
    } catch {
      // ignore
    }
  }

  const emptyDetail: BusRouteDetail = {
    route: {
      routeUid: `${city}-${routeName}`,
      routeName,
      city,
      cityName: city,
      departureStop: '',
      destinationStop: '',
      operatorName: '目前暫無即時資料',
    },
    direction,
    headsign: '',
    stops: [],
    shape: [],
    vehicles: [],
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'tdx',
  };
  return NextResponse.json(emptyDetail, { headers: NO_STORE_HEADERS });
}
