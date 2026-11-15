import { getMockMetroStation, getMockThsrTrains, getMockTraData, METRO_SYSTEMS } from './mock-data';
import { getMetroStationCoord, getThsrStationCoord, getTraStationCoord } from './rail-geo';
import { fetchTdx, isTdxConfigured } from './tdx-client';
import {
  DataSourceMode,
  LiveRailVehicle,
  MetroPlatformArrival,
  MetroStationDetail,
  ThsrTrainRow,
  TraTrainRow,
} from './types';

function getTaipeiNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;
  const minutesOfDay =
    Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  return { dateStr, timeStr, hhmm: `${parts.hour}:${parts.minute}`, minutesOfDay };
}

function parseHhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

// ==========================================
// 1. 捷運即時看板與真實列車位置 (TDX LiveBoard)
// ==========================================
interface TdxMetroLiveBoard {
  LineID?: string;
  LineNO?: string;
  StationID: string;
  StationName?: { Zh_tw?: string };
  TripHeadSign?: string;
  DestinationStationID?: string;
  DestinationStationName?: { Zh_tw?: string };
  EstimateTime?: number;
  ServiceStatus?: number;
}

export async function getRealMetroStation(
  systemId: string,
  stationId: string
): Promise<MetroStationDetail> {
  const sys = METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];
  let matchedLine = sys.lines[0];
  let matchedStation = matchedLine.stations[0];
  for (const line of sys.lines) {
    const found = line.stations.find((st) => st.id === stationId);
    if (found) {
      matchedLine = line;
      matchedStation = found;
      break;
    }
  }

  const { timeStr } = getTaipeiNow();

  if (!isTdxConfigured()) {
    return getMockMetroStation(systemId, stationId);
  }

  try {
    const raw = await fetchTdx<TdxMetroLiveBoard[]>(
      `/v2/Rail/Metro/LiveBoard/${sys.id}?%24format=JSON`,
      15
    );
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) {
      return getMockMetroStation(systemId, stationId);
    }

    // 1. 目前車站的月台到站資訊
    const stationRows = list.filter(
      (r) =>
        r.StationID === matchedStation.id ||
        (r.StationName?.Zh_tw && r.StationName.Zh_tw === matchedStation.name)
    );

    const byDir = new Map<string, TdxMetroLiveBoard[]>();
    for (const row of stationRows) {
      const dest =
        row.DestinationStationName?.Zh_tw || row.TripHeadSign || '列車';
      const arr = byDir.get(dest) || [];
      arr.push(row);
      byDir.set(dest, arr);
    }

    const platforms: MetroPlatformArrival[] = [];
    let platIdx = 1;
    for (const [dest, rows] of byDir.entries()) {
      const sorted = [...rows].sort(
        (a, b) => (a.EstimateTime ?? 99) - (b.EstimateTime ?? 99)
      );
      const firstMin = sorted[0]?.EstimateTime;
      const secondMin = sorted[1]?.EstimateTime;
      if (firstMin === undefined) continue;
      platforms.push({
        platformName: `第 ${platIdx} 月台`,
        destination: dest.startsWith('往') ? dest : `往 ${dest}`,
        nextTrainSeconds: firstMin <= 0 ? 20 : firstMin * 60,
        followingTrainSeconds:
          secondMin !== undefined && secondMin >= 0 ? secondMin * 60 : 0,
      });
      platIdx++;
    }

    // 2. 從全線各站真實 EstimateTime 推導目前線上真實行駛中的列車位置
    const lineStationIds = new Set(matchedLine.stations.map((s) => s.id));
    const lineRows = list.filter(
      (r) =>
        lineStationIds.has(r.StationID) ||
        r.LineID === matchedLine.code ||
        r.LineNO === matchedLine.code
    );

    const liveVehicles: LiveRailVehicle[] = [];
    const seenKeys = new Set<string>();

    // 按方向分組 (往終點 vs 往起點)
    const dirGroups = new Map<string, Map<string, TdxMetroLiveBoard>>();
    for (const r of lineRows) {
      const destName = r.DestinationStationName?.Zh_tw || r.TripHeadSign || '列車';
      let stMap = dirGroups.get(destName);
      if (!stMap) {
        stMap = new Map();
        dirGroups.set(destName, stMap);
      }
      const prev = stMap.get(r.StationID);
      if (!prev || (r.EstimateTime ?? 99) < (prev.EstimateTime ?? 99)) {
        stMap.set(r.StationID, r);
      }
    }

    for (const [destName, stMap] of dirGroups.entries()) {
      const stations = matchedLine.stations;
      const destIdx = stations.findIndex((s) => destName.includes(s.name));
      const isReverse = destIdx === 0;
      const ordered = isReverse ? [...stations].reverse() : stations;

      for (let i = 0; i < ordered.length; i++) {
        const st = ordered[i];
        const row = stMap.get(st.id);
        if (!row || row.EstimateTime === undefined || row.EstimateTime > 2) continue;

        const coord = getMetroStationCoord(sys.id, st.id);
        if (!coord) continue;

        let lat = coord[0];
        let lng = coord[1];
        const est = row.EstimateTime;

        // 若 EstimateTime 為 1~2 分鐘且有前一站，插值在兩站之間；若為 0 分鐘則表示剛進站
        if (est > 0 && i > 0) {
          const prevSt = ordered[i - 1];
          const prevRow = stMap.get(prevSt.id);
          const prevCoord = getMetroStationCoord(sys.id, prevSt.id);
          if (prevCoord && (!prevRow || (prevRow.EstimateTime ?? 99) > est)) {
            const ratio = Math.min(0.9, Math.max(0.2, 1 - est / 2.5));
            lat = prevCoord[0] + (coord[0] - prevCoord[0]) * ratio;
            lng = prevCoord[1] + (coord[1] - prevCoord[1]) * ratio;
          }
        }

        const key = `${destName}-${i}`;
        const prevKey = `${destName}-${i - 1}`;
        if (seenKeys.has(prevKey)) continue;
        seenKeys.add(key);

        const dirLabel = destName.startsWith('往') ? destName : `往 ${destName}`;
        liveVehicles.push({
          id: `metro-live-${sys.id}-${matchedLine.code}-${destName}-${st.id}`,
          label: `${isReverse ? '←' : '→'} ${st.name}`,
          title: `${sys.name} ${matchedLine.name} (${dirLabel})`,
          subtitle:
            est === 0
              ? `進站中：${st.name}站`
              : `約 ${est} 分鐘抵達 ${st.name}站`,
          lat,
          lng,
          color: matchedLine.color,
        });
      }
    }

    const fallbackMock = platforms.length === 0 ? getMockMetroStation(systemId, stationId) : null;

    return {
      systemId: sys.id,
      systemName: sys.name,
      lineCode: matchedLine.code,
      lineName: matchedLine.name,
      lineColor: matchedLine.color,
      stationId: matchedStation.id,
      stationName: matchedStation.name,
      platforms: fallbackMock ? fallbackMock.platforms : platforms,
      liveVehicles,
      updatedAt: timeStr,
      source: 'tdx',
    };
  } catch {
    return getMockMetroStation(systemId, stationId);
  }
}

// ==========================================
// 2. 台鐵即時列車位置、車站電子看板與起訖點時刻表
// ==========================================
interface TdxTraTrainLive {
  TrainNo: string;
  TrainTypeName?: { Zh_tw?: string };
  StationID: string;
  StationName?: { Zh_tw?: string };
  TrainStationStatus?: number;
  DelayTime?: number;
}

interface TdxTraStationBoard {
  TrainNo: string;
  Direction: number;
  TrainTypeName?: { Zh_tw?: string };
  EndingStationName?: { Zh_tw?: string };
  ScheduleDepartureTime?: string;
  ScheduleArrivalTime?: string;
  DelayTime?: number;
}

interface TdxTraOdTimetable {
  TrainInfo: {
    TrainNo: string;
    Direction: number;
    TrainTypeName?: { Zh_tw?: string };
    StartingStationName?: { Zh_tw?: string };
    EndingStationName?: { Zh_tw?: string };
  };
  StopTimes: {
    StationID: string;
    StationName?: { Zh_tw?: string };
    ArrivalTime: string;
    DepartureTime: string;
  }[];
}

function normalizeTraType(raw?: string): TraTrainRow['trainType'] {
  if (!raw) return '區間';
  if (raw.includes('3000') || raw.includes('新自強')) return '新自強';
  if (raw.includes('普悠瑪')) return '普悠瑪';
  if (raw.includes('太魯閣')) return '太魯閣';
  if (raw.includes('自強')) return '自強';
  if (raw.includes('莒光')) return '莒光';
  if (raw.includes('區間快')) return '區間快';
  return '區間';
}

export async function getRealTraData(
  mode: 'board' | 'od',
  station: string,
  from: string,
  to: string
): Promise<{
  trains: TraTrainRow[];
  liveVehicles: LiveRailVehicle[];
  updatedAt: string;
  source: DataSourceMode;
}> {
  const { dateStr, timeStr, hhmm } = getTaipeiNow();

  if (!isTdxConfigured()) {
    return {
      trains: getMockTraData(mode, station, from, to),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'mock',
    };
  }

  try {
    const liveRes = await fetchTdx<{ TrainLiveBoards?: TdxTraTrainLive[] }>(
      '/v3/Rail/TRA/TrainLiveBoard?%24format=JSON',
      15
    );
    const liveList = Array.isArray(liveRes?.TrainLiveBoards)
      ? liveRes.TrainLiveBoards
      : [];

    const delayMap = new Map<string, number>();
    const liveVehicles: LiveRailVehicle[] = [];

    for (const item of liveList) {
      delayMap.set(item.TrainNo, item.DelayTime ?? 0);
      const coord = getTraStationCoord(item.StationID);
      if (!coord) continue;
      const tType = normalizeTraType(item.TrainTypeName?.Zh_tw);
      const delay = item.DelayTime ?? 0;
      const statusLabel =
        item.TrainStationStatus === 0
          ? '進站中'
          : item.TrainStationStatus === 1
            ? '停靠中'
            : '已離站行駛中';
      const color =
        tType === '新自強' || tType === '普悠瑪' || tType === '太魯閣'
          ? '#e11d48'
          : tType === '自強'
            ? '#f97316'
            : '#4f46e5';

      liveVehicles.push({
        id: `tra-live-${item.TrainNo}`,
        label: `${tType} ${item.TrainNo}`,
        title: `台鐵 ${tType} ${item.TrainNo} 次`,
        subtitle: `目前位置：${item.StationName?.Zh_tw || item.StationID} (${statusLabel})<br/>${
          delay > 0 ? `晚 ${delay} 分鐘` : '準點'
        }`,
        lat: coord[0],
        lng: coord[1],
        color,
      });
    }

    let trains: TraTrainRow[] = [];

    if (mode === 'board') {
      const boardRes = await fetchTdx<{ StationLiveBoards?: TdxTraStationBoard[] }>(
        `/v3/Rail/TRA/StationLiveBoard/Station/${encodeURIComponent(station)}?%24format=JSON`,
        15
      );
      const rows = Array.isArray(boardRes?.StationLiveBoards)
        ? boardRes.StationLiveBoards
        : [];
      trains = rows.map((r) => {
        const delay = r.DelayTime ?? delayMap.get(r.TrainNo) ?? 0;
        return {
          trainNo: r.TrainNo,
          trainType: normalizeTraType(r.TrainTypeName?.Zh_tw),
          direction: r.Direction === 1 ? 1 : 0,
          originStation: '',
          destinationStation: r.EndingStationName?.Zh_tw || '終點站',
          departureTime: (r.ScheduleDepartureTime || r.ScheduleArrivalTime || '--:--').slice(0, 5),
          arrivalTime: (r.ScheduleArrivalTime || '--:--').slice(0, 5),
          durationMinutes: 0,
          delayMinutes: delay,
          statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
        };
      });
    } else {
      const odRes = await fetchTdx<{ TrainTimetables?: TdxTraOdTimetable[] }>(
        `/v3/Rail/TRA/DailyTrainTimetable/OD/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}/${dateStr}?%24format=JSON`,
        300
      );
      const rows = Array.isArray(odRes?.TrainTimetables) ? odRes.TrainTimetables : [];
      const mapped = rows
        .map((r): TraTrainRow | null => {
          const s0 = r.StopTimes[0];
          const s1 = r.StopTimes[r.StopTimes.length - 1];
          if (!s0 || !s1) return null;
          const dep = s0.DepartureTime.slice(0, 5);
          const arr = s1.ArrivalTime.slice(0, 5);
          let dur = parseHhmmToMinutes(arr) - parseHhmmToMinutes(dep);
          if (dur < 0) dur += 1440;
          const delay = delayMap.get(r.TrainInfo.TrainNo) ?? 0;
          return {
            trainNo: r.TrainInfo.TrainNo,
            trainType: normalizeTraType(r.TrainInfo.TrainTypeName?.Zh_tw),
            direction: (r.TrainInfo.Direction === 1 ? 1 : 0) as 0 | 1,
            originStation: s0.StationName?.Zh_tw || '',
            destinationStation: s1.StationName?.Zh_tw || '',
            departureTime: dep,
            arrivalTime: arr,
            durationMinutes: dur,
            delayMinutes: delay,
            statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
          };
        })
        .filter((x): x is TraTrainRow => x !== null)
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime));

      const upcoming = mapped.filter((t) => t.departureTime >= hhmm);
      trains = (upcoming.length > 0 ? upcoming : mapped).slice(0, 20);
    }

    return {
      trains,
      liveVehicles: liveVehicles.slice(0, 55),
      updatedAt: timeStr,
      source: 'tdx',
    };
  } catch {
    return {
      trains: getMockTraData(mode, station, from, to),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'mock',
    };
  }
}

// ==========================================
// 3. 高鐵今日時刻、剩餘座位與即時行駛列車位置
// ==========================================
interface TdxThsrDaily {
  DailyTrainInfo: {
    TrainNo: string;
    Direction: number;
    StartingStationID: string;
    StartingStationName?: { Zh_tw?: string };
    EndingStationID: string;
    EndingStationName?: { Zh_tw?: string };
  };
  StopTimes: {
    StopSequence: number;
    StationID: string;
    StationName?: { Zh_tw?: string };
    ArrivalTime: string;
    DepartureTime: string;
  }[];
}

interface TdxThsrSeatList {
  AvailableSeats?: {
    TrainNo: string;
    StopStations?: {
      StationID: string;
      StandardSeatStatus?: 'O' | 'L' | 'X';
      BusinessSeatStatus?: 'O' | 'L' | 'X';
    }[];
  }[];
}

function mapSeatCode(code?: 'O' | 'L' | 'X'): 'available' | 'limited' | 'full' {
  if (code === 'X') return 'full';
  if (code === 'L') return 'limited';
  return 'available';
}

export async function getRealThsrData(
  from: string,
  to: string
): Promise<{
  trains: ThsrTrainRow[];
  liveVehicles: LiveRailVehicle[];
  updatedAt: string;
  source: DataSourceMode;
}> {
  const { timeStr, hhmm, minutesOfDay } = getTaipeiNow();

  if (!isTdxConfigured()) {
    return {
      trains: getMockThsrTrains(from, to),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'mock',
    };
  }

  try {
    const [daily, seatData] = await Promise.all([
      fetchTdx<TdxThsrDaily[]>('/v2/Rail/THSR/DailyTimetable/Today?%24format=JSON', 3600),
      fetchTdx<TdxThsrSeatList>(
        `/v2/Rail/THSR/AvailableSeatStatusList/${encodeURIComponent(from)}?%24format=JSON`,
        60
      ).catch(() => ({ AvailableSeats: [] })),
    ]);

    const seatMap = new Map<
      string,
      { std: 'available' | 'limited' | 'full'; biz: 'available' | 'limited' | 'full' }
    >();
    for (const s of seatData?.AvailableSeats || []) {
      const target = s.StopStations?.find((st) => st.StationID === to);
      if (target) {
        seatMap.set(s.TrainNo, {
          std: mapSeatCode(target.StandardSeatStatus),
          biz: mapSeatCode(target.BusinessSeatStatus),
        });
      }
    }

    const dailyList = Array.isArray(daily) ? daily : [];
    const odTrains: ThsrTrainRow[] = [];
    const liveVehicles: LiveRailVehicle[] = [];

    for (const item of dailyList) {
      const stops = item.StopTimes;
      if (!stops || stops.length < 2) continue;

      // 1. 計算此刻真實行駛在軌道上的高鐵列車位置
      const firstDep = parseHhmmToMinutes(stops[0].DepartureTime);
      const lastArr = parseHhmmToMinutes(stops[stops.length - 1].ArrivalTime);
      if (minutesOfDay >= firstDep && minutesOfDay <= lastArr) {
        for (let i = 0; i < stops.length - 1; i++) {
          const a = stops[i];
          const b = stops[i + 1];
          const tA = parseHhmmToMinutes(a.DepartureTime);
          const tB = parseHhmmToMinutes(b.ArrivalTime);
          if (minutesOfDay >= tA && minutesOfDay <= tB) {
            const cA = getThsrStationCoord(a.StationID);
            const cB = getThsrStationCoord(b.StationID);
            if (cA && cB) {
              const ratio = Math.min(1, Math.max(0, (minutesOfDay - tA) / Math.max(0.5, tB - tA)));
              const lat = cA[0] + (cB[0] - cA[0]) * ratio;
              const lng = cA[1] + (cB[1] - cA[1]) * ratio;
              const etaMin = Math.max(1, Math.ceil(tB - minutesOfDay));
              liveVehicles.push({
                id: `thsr-live-${item.DailyTrainInfo.TrainNo}`,
                label: item.DailyTrainInfo.TrainNo,
                title: `高鐵 ${item.DailyTrainInfo.TrainNo} 次`,
                subtitle: `${item.DailyTrainInfo.StartingStationName?.Zh_tw || ''} → ${
                  item.DailyTrainInfo.EndingStationName?.Zh_tw || ''
                }<br/>下一站：${b.StationName?.Zh_tw || ''} (約 ${etaMin} 分鐘抵達)`,
                lat,
                lng,
                color: '#ea580c',
              });
            }
            break;
          }
        }
      }

      // 2. 篩選起訖站符合的班次
      const fromIdx = stops.findIndex((s) => s.StationID === from);
      const toIdx = stops.findIndex((s) => s.StationID === to);
      if (fromIdx >= 0 && toIdx > fromIdx) {
        const sFrom = stops[fromIdx];
        const sTo = stops[toIdx];
        const dur = parseHhmmToMinutes(sTo.ArrivalTime) - parseHhmmToMinutes(sFrom.DepartureTime);
        const seats = seatMap.get(item.DailyTrainInfo.TrainNo);
        const stopCount = toIdx - fromIdx;
        const stopPattern: ThsrTrainRow['stopPattern'] =
          stopCount <= 2 ? '直達' : stopCount <= 5 ? '跳蛙' : '站站停';

        odTrains.push({
          trainNo: item.DailyTrainInfo.TrainNo,
          originStation: sFrom.StationName?.Zh_tw || '',
          destinationStation: sTo.StationName?.Zh_tw || '',
          departureTime: sFrom.DepartureTime.slice(0, 5),
          arrivalTime: sTo.ArrivalTime.slice(0, 5),
          durationMinutes: dur,
          stopPattern,
          standardSeatStatus: seats?.std ?? 'available',
          businessSeatStatus: seats?.biz ?? 'available',
          nonReservedCars: '10-12車',
        });
      }
    }

    odTrains.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    const upcoming = odTrains.filter((t) => t.departureTime >= hhmm);

    return {
      trains: (upcoming.length > 0 ? upcoming : odTrains).slice(0, 20),
      liveVehicles,
      updatedAt: timeStr,
      source: 'tdx',
    };
  } catch {
    return {
      trains: getMockThsrTrains(from, to),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'mock',
    };
  }
}
