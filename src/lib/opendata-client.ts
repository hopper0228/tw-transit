/**
 * 政府公開免金鑰即時 OpenData 整合客戶端
 * 提供：
 * 1. 台北市政府公車即時資料 (blobbus: GetRoute / GetStop / GetEstimateTime / GetBusData)
 * 2. 台北市 & 新北市 YouBike 2.0 即時資料
 * 3. 台北市停管處路外停車場即時空位 (TCMSV)
 */

import zlib from 'zlib';
import {
  BusRouteDetail,
  BusRouteInfo,
  BusStopStatus,
  ParkingLot,
  YouBikeStation,
} from './types';

interface CacheItem<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheItem<unknown>>();

async function fetchCachedJson<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  isGzip = false
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`OpenData fetch failed (${res.status}): ${url}`);
  }

  let text: string;
  if (isGzip) {
    const buf = Buffer.from(await res.arrayBuffer());
    text = zlib.gunzipSync(buf).toString('utf8');
  } else {
    text = await res.text();
  }

  const parsed = JSON.parse(text) as T;
  cache.set(key, {
    data: parsed,
    expiresAt: now + ttlSeconds * 1000,
  });
  return parsed;
}

// ==========================================
// 1. 台北市公車 OpenData (blobbus)
// ==========================================
interface BlobBusRoute {
  Id: number;
  nameZh: string;
  providerName?: string;
  departureZh?: string;
  destinationZh?: string;
}

interface BlobBusStop {
  Id: number;
  routeId: number;
  nameZh: string;
  seqNo: number;
  longitude: string;
  latitude: string;
  goBack: string; // "0" 去程, "1" 返程
}

interface BlobBusEstimate {
  RouteID: number;
  StopID: number;
  EstimateTime: string; // 秒數字串; -1 尚未發車, -2 交管不停靠, -3 末班已過, -4 今日未營運
  GoBack: string;
}

interface BlobBusVehicle {
  BusID: string;
  CarType?: string; // "1"=低地板
  RouteID: string | number;
  GoBack: string;
  Longitude: string;
  Latitude: string;
  Azimuth?: string;
  DataTime?: string;
}

export async function getTaipeiBusRoutes(query?: string): Promise<BusRouteInfo[]> {
  const raw = await fetchCachedJson<{ BusInfo: BlobBusRoute[] }>(
    'tpe-bus-routes',
    'https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz',
    3600,
    true
  );

  const q = (query || '').trim().toLowerCase();
  const seen = new Set<string>();
  const results: BusRouteInfo[] = [];

  for (const r of raw.BusInfo || []) {
    const name = r.nameZh?.trim();
    if (!name || seen.has(name)) continue;

    if (
      q &&
      !name.toLowerCase().includes(q) &&
      !(r.departureZh || '').toLowerCase().includes(q) &&
      !(r.destinationZh || '').toLowerCase().includes(q)
    ) {
      continue;
    }

    seen.add(name);
    results.push({
      routeUid: String(r.Id),
      routeName: name,
      city: 'Taipei',
      cityName: '雙北公車 (即時)',
      departureStop: r.departureZh || '起站',
      destinationStop: r.destinationZh || '迄站',
      operatorName: r.providerName || '公車業者',
    });
  }

  return results;
}

export async function getTaipeiBusRouteDetail(
  routeName: string,
  direction: 0 | 1
): Promise<BusRouteDetail | null> {
  const [routesData, stopsData, estData, busData] = await Promise.all([
    fetchCachedJson<{ BusInfo: BlobBusRoute[] }>(
      'tpe-bus-routes',
      'https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz',
      3600,
      true
    ),
    fetchCachedJson<{ BusInfo: BlobBusStop[] }>(
      'tpe-bus-stops',
      'https://tcgbusfs.blob.core.windows.net/blobbus/GetStop.gz',
      3600,
      true
    ),
    fetchCachedJson<{ BusInfo: BlobBusEstimate[] }>(
      'tpe-bus-eta',
      'https://tcgbusfs.blob.core.windows.net/blobbus/GetEstimateTime.gz',
      15,
      true
    ),
    fetchCachedJson<{ BusInfo: BlobBusVehicle[] }>(
      'tpe-bus-vehicles',
      'https://tcgbusfs.blob.core.windows.net/blobbus/GetBusData.gz',
      15,
      true
    ),
  ]);

  const route = routesData.BusInfo.find(
    (r) => r.nameZh?.trim().toLowerCase() === routeName.trim().toLowerCase()
  );
  if (!route) return null;

  const dirStr = String(direction);
  let routeStops = stopsData.BusInfo.filter(
    (s) => s.routeId === route.Id && s.goBack === dirStr
  ).sort((a, b) => a.seqNo - b.seqNo);

  // 部分單向循環路線只有 goBack "0"
  if (routeStops.length === 0 && direction === 1) {
    routeStops = stopsData.BusInfo.filter(
      (s) => s.routeId === route.Id && s.goBack === '0'
    ).sort((a, b) => b.seqNo - a.seqNo);
  }

  const etaMap = new Map<number, number>();
  for (const e of estData.BusInfo) {
    if (e.RouteID === route.Id && (e.GoBack === dirStr || e.GoBack === '2')) {
      const val = Number(e.EstimateTime);
      if (!Number.isNaN(val)) {
        etaMap.set(e.StopID, val);
      }
    }
  }

  const routeVehiclesRaw = busData.BusInfo.filter(
    (v) => String(v.RouteID) === String(route.Id) && v.GoBack === dirStr
  );

  const vehicles = routeVehiclesRaw
    .map((v) => ({
      plateNumb: v.BusID,
      lat: Number(v.Latitude),
      lng: Number(v.Longitude),
      azimuth: Number(v.Azimuth || 0),
      isLowFloor: v.CarType === '1',
      isElectric: v.BusID.startsWith('EAL'),
      nearStopSeq: 0,
    }))
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.lat > 20);

  // 為每個進站中的站牌找出距離最近的公車車牌
  const stops: BusStopStatus[] = routeStops.map((s) => {
    const rawEst = etaMap.get(s.Id);
    let estimateSeconds: number | null = null;
    let stopStatus: BusStopStatus['stopStatus'] = 1;

    if (rawEst !== undefined) {
      if (rawEst >= 0) {
        estimateSeconds = rawEst;
        stopStatus = 0;
      } else if (rawEst === -3) {
        stopStatus = 3;
      } else if (rawEst === -2) {
        stopStatus = 2;
      } else if (rawEst === -4) {
        stopStatus = 4;
      } else {
        stopStatus = 1;
      }
    }

    const lat = Number(s.latitude);
    const lng = Number(s.longitude);

    let approachingBus: BusStopStatus['approachingBus'] = undefined;
    if (estimateSeconds !== null && estimateSeconds <= 180 && vehicles.length > 0) {
      let nearest = vehicles[0];
      let minDist = Infinity;
      for (const v of vehicles) {
        const d = (v.lat - lat) ** 2 + (v.lng - lng) ** 2;
        if (d < minDist) {
          minDist = d;
          nearest = v;
        }
      }
      approachingBus = {
        plateNumb: nearest.plateNumb,
        isLowFloor: nearest.isLowFloor,
        isElectric: nearest.isElectric,
        atStop: estimateSeconds <= 45,
      };
    }

    return {
      stopUid: `${route.Id}-${s.Id}`,
      stopName: s.nameZh,
      sequence: s.seqNo,
      lat,
      lng,
      estimateSeconds,
      stopStatus,
      approachingBus,
    };
  });

  return {
    route: {
      routeUid: String(route.Id),
      routeName: route.nameZh,
      city: 'Taipei',
      cityName: '雙北公車 (即時)',
      departureStop: route.departureZh || stops[0]?.stopName || '起站',
      destinationStop:
        route.destinationZh || stops[stops.length - 1]?.stopName || '迄站',
      operatorName: route.providerName || '公車業者',
    },
    direction,
    headsign:
      direction === 0
        ? `往 ${route.destinationZh || '迄站'}`
        : `往 ${route.departureZh || '起站'}`,
    stops,
    shape: stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 20)
      .map((s) => [s.lat, s.lng]),
    vehicles,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'opendata',
  };
}

// ==========================================
// 2. YouBike 2.0 即時 OpenData (台北 + 新北)
// ==========================================
interface TaipeiYouBikeRaw {
  sno: string;
  sna: string;
  sarea: string;
  ar: string;
  latitude: number;
  longitude: number;
  Quantity: number;
  available_rent_bikes: number;
  available_return_bikes: number;
  act: string;
  updateTime: string;
}

interface NewTaipeiYouBikeRaw {
  sno: string;
  sna: string;
  sarea: string;
  ar: string;
  lat: string;
  lng: string;
  tot_quantity: string;
  sbi_quantity: string;
  bemp: string;
  mday: string;
  act: string;
}

export async function getRealYouBikeStations(
  city: string,
  query?: string
): Promise<YouBikeStation[]> {
  const results: YouBikeStation[] = [];

  if (city === 'All' || city === 'Taipei') {
    const tpe = await fetchCachedJson<TaipeiYouBikeRaw[]>(
      'tpe-youbike',
      'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json',
      30
    );
    for (const st of tpe) {
      results.push({
        stationUid: st.sno,
        stationName: st.sna.replace(/^YouBike2\.0_/, ''),
        city: 'Taipei',
        address: `${st.sarea} · ${st.ar}`,
        lat: Number(st.latitude),
        lng: Number(st.longitude),
        totalDocks: Number(st.Quantity || 0),
        availableBikes20: Number(st.available_rent_bikes || 0),
        availableBikes20E: 0,
        availableReturnDocks: Number(st.available_return_bikes || 0),
        serviceStatus: st.act === '1' ? 1 : 0,
        updatedAt: st.updateTime?.slice(11, 19) || '剛剛',
      });
    }
  }

  if (city === 'All' || city === 'NewTaipei') {
    const ntpc = await fetchCachedJson<NewTaipeiYouBikeRaw[]>(
      'ntpc-youbike',
      'https://data.ntpc.gov.tw/api/datasets/010e5b15-3823-4b20-b401-b1cf000550c5/json?size=500',
      30
    );
    for (const st of ntpc) {
      const tot = Number(st.tot_quantity || 0);
      const sbi = Number(st.sbi_quantity || 0);
      const bemp = Number(st.bemp ?? Math.max(0, tot - sbi));
      results.push({
        stationUid: st.sno,
        stationName: st.sna.replace(/^YouBike2\.0_/, ''),
        city: 'NewTaipei',
        address: `${st.sarea} · ${st.ar}`,
        lat: Number(st.lat),
        lng: Number(st.lng),
        totalDocks: tot,
        availableBikes20: sbi,
        availableBikes20E: 0,
        availableReturnDocks: bemp,
        serviceStatus: st.act === '1' ? 1 : 0,
        updatedAt: '即時',
      });
    }
  }

  const q = (query || '').trim().toLowerCase();
  if (!q) return results;

  return results.filter(
    (s) =>
      s.stationName.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q)
  );
}

// ==========================================
// 3. 台北市停管處即時停車場 OpenData (TCMSV)
// ==========================================
interface TcmsvParkDesc {
  id: string;
  area: string;
  name: string;
  type: string;
  address: string;
  payex: string;
  totalcar: number;
  EntranceCoord?: {
    EntrancecoordInfo?: { Xcod: string; Ycod: string }[];
  };
}

interface TcmsvParkAvail {
  id: string;
  availablecar: number;
}

export async function getRealTaipeiParkingLots(
  query?: string,
  onlyAvailable = false
): Promise<ParkingLot[]> {
  const [descJson, availJson] = await Promise.all([
    fetchCachedJson<{ data: { park: TcmsvParkDesc[] } }>(
      'tpe-parking-desc',
      'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json',
      3600
    ),
    fetchCachedJson<{ data: { park: TcmsvParkAvail[] } }>(
      'tpe-parking-avail',
      'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json',
      30
    ),
  ]);

  const availMap = new Map<string, number>();
  for (const a of availJson.data?.park || []) {
    availMap.set(a.id, a.availablecar);
  }

  const q = (query || '').trim().toLowerCase();
  const lots: ParkingLot[] = [];

  for (const p of descJson.data?.park || []) {
    const rawAvail = availMap.get(p.id);
    if (rawAvail === undefined || rawAvail < 0) continue; // -9 代表未連線即時資料
    if (onlyAvailable && rawAvail === 0) continue;

    if (
      q &&
      !p.name.toLowerCase().includes(q) &&
      !p.address.toLowerCase().includes(q) &&
      !p.area.toLowerCase().includes(q)
    ) {
      continue;
    }

    const coord = p.EntranceCoord?.EntrancecoordInfo?.[0];
    const lat = coord ? Number(coord.Xcod) : 25.0478;
    const lng = coord ? Number(coord.Ycod) : 121.517;

    lots.push({
      carParkId: p.id,
      name: p.name,
      city: 'Taipei',
      address: `${p.area} · ${p.address}`,
      lat: Number.isFinite(lat) ? lat : 25.0478,
      lng: Number.isFinite(lng) ? lng : 121.517,
      totalSpaces: p.totalcar || 0,
      availableSpaces: rawAvail,
      fareDescription: p.payex?.slice(0, 80) || '依現場公告',
      parkingType: p.type === '1' ? '立體' : '平面',
      updatedAt: '即時',
    });
  }

  return lots;
}
