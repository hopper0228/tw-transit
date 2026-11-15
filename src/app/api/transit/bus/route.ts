import { NextRequest, NextResponse } from 'next/server';
import { getMockBusRouteDetail, MOCK_BUS_ROUTES } from '@/lib/mock-data';
import {
  GeoPoint,
  getTaipeiBusRouteDetail,
  getTaipeiBusRoutes,
} from '@/lib/opendata-client';
import { fetchTdx, isTdxConfigured } from '@/lib/tdx-client';
import { BusRouteDetail, BusStopStatus } from '@/lib/types';

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

    const filtered = MOCK_BUS_ROUTES.filter((r) => {
      const matchCity = city === 'All' || r.city === city;
      const matchQ =
        !q ||
        r.routeName.toLowerCase().includes(q) ||
        r.departureStop.toLowerCase().includes(q) ||
        r.destinationStop.toLowerCase().includes(q);
      return matchCity && matchQ;
    });

    return NextResponse.json({ routes: filtered, source: 'mock' });
  }

  // 2. 指定特定路線：回傳該路線即時站序與到站時間
  if (isTdxConfigured() && city !== 'InterCity') {
    try {
      const encodedRoute = encodeURIComponent(routeName);
      const [stopOfRoutes, etas] = await Promise.all([
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
        >(`/v2/Bus/StopOfRoute/City/${city}/${encodedRoute}?$format=JSON`, 3600),
        fetchTdx<
          {
            StopUID: string;
            Direction: number;
            EstimateTime?: number;
            StopStatus: number;
            PlateNumb?: string;
          }[]
        >(`/v2/Bus/EstimatedTimeOfArrival/City/${city}/${encodedRoute}?$format=JSON`, 15),
      ]);

      const dirRoute =
        stopOfRoutes.find(
          (r) => r.RouteName.Zh_tw === routeName && r.Direction === direction
        ) || stopOfRoutes[0];

      if (dirRoute) {
        const etaMap = new Map(
          etas.filter((e) => e.Direction === direction).map((e) => [e.StopUID, e])
        );

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
          vehicles: [],
          updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          source: 'tdx',
        };

        return NextResponse.json(detail);
      }
    } catch {
      // fallback below
    }
  }

  // 雙北公車使用免帳號真實台北市 OpenData 即時動態
  if (city === 'Taipei' || city === 'All') {
    try {
      const realDetail = await getTaipeiBusRouteDetail(routeName, direction);
      if (realDetail) {
        return NextResponse.json(realDetail);
      }
    } catch {
      // fallback below
    }
  }

  const mockDetail = getMockBusRouteDetail(routeName, city, direction);
  return NextResponse.json(mockDetail);
}
