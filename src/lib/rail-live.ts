import { METRO_SYSTEMS } from './mock-data';
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
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'long',
  }).format(now) as
    | 'Sunday'
    | 'Monday'
    | 'Tuesday'
    | 'Wednesday'
    | 'Thursday'
    | 'Friday'
    | 'Saturday';
  return {
    dateStr,
    timeStr,
    hhmm: `${parts.hour}:${parts.minute}`,
    minutesOfDay,
    weekday,
  };
}

function parseHhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function parseSourceTimeMs(iso?: string): number {
  if (iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
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
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

interface TdxMetroStationTimetable {
  LineID?: string;
  StationID: string;
  Direction?: number;
  DestinationStationID?: string;
  DestinationStaionID?: string;
  DestinationStationName?: { Zh_tw?: string };
  ServiceDay?: Record<string, boolean | string>;
  Timetables?: {
    Sequence: number;
    DepartureTime: string;
  }[];
}

interface CompactMetroTable {
  destId?: string;
  destName: string;
  serviceDay?: Record<string, boolean | string>;
  timesMin: number[];
}

const metroScheduleIndexCache = new Map<
  string,
  { expiresAt: number; byStation: Map<string, CompactMetroTable[]> }
>();

async function getMetroStationTables(
  sysId: string,
  stationId: string
): Promise<CompactMetroTable[]> {
  const now = Date.now();
  const cached = metroScheduleIndexCache.get(sysId);
  if (cached && cached.expiresAt > now) {
    return cached.byStation.get(stationId) || [];
  }

  const ttRaw = await fetchTdx<TdxMetroStationTimetable[]>(
    `/v2/Rail/Metro/StationTimeTable/${sysId}?%24format=JSON`,
    21600
  ).catch(() => [] as TdxMetroStationTimetable[]);

  const byStation = new Map<string, CompactMetroTable[]>();
  if (Array.isArray(ttRaw) && ttRaw.length > 0) {
    for (const tb of ttRaw) {
      if (!tb.StationID) continue;
      const arr = byStation.get(tb.StationID) || [];
      arr.push({
        destId: tb.DestinationStationID || tb.DestinationStaionID,
        destName: tb.DestinationStationName?.Zh_tw || '',
        serviceDay: tb.ServiceDay,
        timesMin: (tb.Timetables || []).map((t) => parseHhmmToMinutes(t.DepartureTime)),
      });
      byStation.set(tb.StationID, arr);
    }
    metroScheduleIndexCache.set(sysId, {
      expiresAt: now + 6 * 3600 * 1000,
      byStation,
    });
  }
  return byStation.get(stationId) || [];
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

  const { timeStr, minutesOfDay, weekday } = getTaipeiNow();
  const stations = matchedLine.stations;
  const stationIdx = stations.findIndex((s) => s.id === matchedStation.id);
  const isStartTerminal = stationIdx === 0;
  const isEndTerminal = stationIdx === stations.length - 1;

  const buildEmptyPlatforms = (): MetroPlatformArrival[] => {
    const res: MetroPlatformArrival[] = [];
    if (!isEndTerminal) {
      res.push({
        platformName: '第 1 月台',
        destination: `往 ${matchedLine.terminals[1]}`,
        nextTrainSeconds: -1,
        followingTrainSeconds: 0,
      });
    }
    if (!isStartTerminal) {
      res.push({
        platformName: isEndTerminal ? '第 1 月台' : '第 2 月台',
        destination: `往 ${matchedLine.terminals[0]}`,
        nextTrainSeconds: -1,
        followingTrainSeconds: 0,
      });
    }
    return res;
  };

  if (!isTdxConfigured()) {
    return {
      systemId: sys.id,
      systemName: sys.name,
      lineCode: matchedLine.code,
      lineName: matchedLine.name,
      lineColor: matchedLine.color,
      stationId: matchedStation.id,
      stationName: matchedStation.name,
      platforms: buildEmptyPlatforms(),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'tdx',
    };
  }

  try {
    const [liveRaw, ttList] = await Promise.all([
      fetchTdx<TdxMetroLiveBoard[]>(
        `/v2/Rail/Metro/LiveBoard/${sys.id}?%24format=JSON`,
        15
      ).catch(() => [] as TdxMetroLiveBoard[]),
      getMetroStationTables(sys.id, matchedStation.id),
    ]);

    const list = Array.isArray(liveRaw) ? liveRaw : [];

    // 1. 精準比對目前車站 (避免轉乘站混入其他路線月台)
    let stationRows = list.filter((r) => r.StationID === matchedStation.id);
    if (stationRows.length === 0) {
      stationRows = list.filter(
        (r) =>
          r.StationName?.Zh_tw === matchedStation.name &&
          (r.LineID === matchedLine.code || r.LineNO === matchedLine.code)
      );
    }

    const resolveDirByDest = (
      destId?: string,
      destName?: string
    ): 'fwd' | 'rev' | null => {
      const name = destName || '';
      const dIdx = stations.findIndex(
        (s) => (destId && s.id === destId) || (name && name.includes(s.name))
      );
      if (dIdx >= 0 && stationIdx >= 0) {
        if (dIdx > stationIdx) return 'fwd';
        if (dIdx < stationIdx) return 'rev';
      }
      if (name.includes(matchedLine.terminals[1])) return 'fwd';
      if (name.includes(matchedLine.terminals[0])) return 'rev';
      return null;
    };

    const fwdRows: TdxMetroLiveBoard[] = [];
    const revRows: TdxMetroLiveBoard[] = [];
    for (const row of stationRows) {
      const dir = resolveDirByDest(
        row.DestinationStationID,
        row.DestinationStationName?.Zh_tw || row.TripHeadSign
      );
      if (dir === 'fwd') fwdRows.push(row);
      else if (dir === 'rev') revRows.push(row);
    }

    const todayTables = ttList.filter(
      (t) => !t.serviceDay || t.serviceDay[weekday] === true
    );
    const activeTables = todayTables.length > 0 ? todayTables : ttList;

    const fwdSched: { sec: number; dest: string }[] = [];
    const revSched: { sec: number; dest: string }[] = [];

    for (const tb of activeTables) {
      const destName = tb.destName;
      const dir = resolveDirByDest(tb.destId, destName);
      if (!dir) continue;
      for (const baseMin of tb.timesMin) {
        let depMin = baseMin;
        if (depMin < 180 && minutesOfDay > 1200) depMin += 1440;
        const diffSec = Math.round((depMin - minutesOfDay) * 60);
        if (diffSec >= 0 && diffSec <= 3600) {
          const entry = { sec: diffSec, dest: destName };
          if (dir === 'fwd') fwdSched.push(entry);
          else revSched.push(entry);
        }
      }
    }

    const dedupeSched = (arr: { sec: number; dest: string }[]) => {
      arr.sort((a, b) => a.sec - b.sec);
      const out: { sec: number; dest: string }[] = [];
      for (const item of arr) {
        if (out.length === 0 || item.sec - out[out.length - 1].sec >= 60) {
          out.push(item);
        }
      }
      return out;
    };

    const fwdUpcoming = dedupeSched(fwdSched);
    const revUpcoming = dedupeSched(revSched);

    const lineStationIds = new Set(stations.map((s) => s.id));
    const lineRows = list.filter(
      (r) =>
        lineStationIds.has(r.StationID) ||
        r.LineID === matchedLine.code ||
        r.LineNO === matchedLine.code
    );

    const buildPlatform = (
      platName: string,
      defaultDest: string,
      liveRows: TdxMetroLiveBoard[],
      sched: { sec: number; dest: string }[]
    ): MetroPlatformArrival => {
      const validLive = liveRows
        .filter((r) => typeof r.EstimateTime === 'number' && r.EstimateTime >= 0)
        .sort((a, b) => (a.EstimateTime ?? 99) - (b.EstimateTime ?? 99));

      if (validLive.length > 0) {
        const firstMin = validLive[0].EstimateTime!;
        const firstSec = firstMin <= 0 ? 20 : firstMin * 60;
        const specificDest =
          validLive[0].DestinationStationName?.Zh_tw || defaultDest;

        let secondSec = 0;
        if (validLive[1]?.EstimateTime !== undefined) {
          secondSec = validLive[1].EstimateTime * 60;
        } else {
          const nextSched = sched.find((s) => s.sec >= firstSec + 90);
          if (nextSched) secondSec = nextSched.sec;
        }

        return {
          platformName: platName,
          destination: specificDest.startsWith('往')
            ? specificDest
            : `往 ${specificDest}`,
          nextTrainSeconds: firstSec,
          followingTrainSeconds: secondSec,
        };
      }

      if (sched.length > 0) {
        const first = sched[0];
        const second = sched[1];
        const dest = first.dest || defaultDest;
        return {
          platformName: platName,
          destination: dest.startsWith('往') ? dest : `往 ${dest}`,
          nextTrainSeconds: Math.max(30, first.sec),
          followingTrainSeconds: second ? second.sec : 0,
        };
      }

      return {
        platformName: platName,
        destination: `往 ${defaultDest}`,
        nextTrainSeconds: -1,
        followingTrainSeconds: 0,
      };
    };

    const platforms: MetroPlatformArrival[] = [];
    if (!isEndTerminal) {
      platforms.push(
        buildPlatform('第 1 月台', matchedLine.terminals[1], fwdRows, fwdUpcoming)
      );
    }
    if (!isStartTerminal) {
      platforms.push(
        buildPlatform(
          isEndTerminal ? '第 1 月台' : '第 2 月台',
          matchedLine.terminals[0],
          revRows,
          revUpcoming
        )
      );
    }

    // 2. 從全線各站真實 EstimateTime 推導目前線上真實行駛中的列車位置

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

    const firstLive = stationRows[0] || list[0];
    const sourceUpdatedAt = parseSourceTimeMs(
      firstLive?.SrcUpdateTime || firstLive?.UpdateTime
    );

    return {
      systemId: sys.id,
      systemName: sys.name,
      lineCode: matchedLine.code,
      lineName: matchedLine.name,
      lineColor: matchedLine.color,
      stationId: matchedStation.id,
      stationName: matchedStation.name,
      platforms,
      liveVehicles,
      updatedAt: timeStr,
      sourceUpdatedAt,
      source: 'tdx',
    };
  } catch {
    return {
      systemId: sys.id,
      systemName: sys.name,
      lineCode: matchedLine.code,
      lineName: matchedLine.name,
      lineColor: matchedLine.color,
      stationId: matchedStation.id,
      stationName: matchedStation.name,
      platforms: buildEmptyPlatforms(),
      liveVehicles: [],
      updatedAt: timeStr,
      source: 'tdx',
    };
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
  StationID?: string;
  TrainNo: string;
  Direction: number;
  TrainTypeName?: { Zh_tw?: string };
  EndingStationName?: { Zh_tw?: string };
  ScheduleDepartureTime?: string;
  ScheduleArrivalTime?: string;
  DelayTime?: number;
}

interface TdxTraDailyTimetableItem {
  TrainInfo: {
    TrainNo: string;
    Direction: number;
    TrainTypeName?: { Zh_tw?: string };
    StartingStationName?: { Zh_tw?: string };
    EndingStationName?: { Zh_tw?: string };
    SuspendedFlag?: number;
  };
  StopTimes: {
    StopSequence: number;
    StationID: string;
    StationName?: { Zh_tw?: string };
    ArrivalTime: string;
    DepartureTime: string;
    SuspendedFlag?: number;
  }[];
}

interface CompactTraBoardStop {
  trainNo: string;
  trainType: TraTrainRow['trainType'];
  direction: 0 | 1;
  bound: 'north' | 'south';
  originStation: string;
  destinationStation: string;
  departureTime: string;
  arrivalTime: string;
  remainingStops: { stationId: string; arrivalTime: string }[];
}

interface CompactTraTrain {
  trainNo: string;
  trainType: TraTrainRow['trainType'];
  direction: 0 | 1;
  stops: {
    stationId: string;
    stationName: string;
    arrivalTime: string;
    departureTime: string;
  }[];
}

interface TraDailyIndex {
  dateStr: string;
  expiresAt: number;
  byStation: Map<string, CompactTraBoardStop[]>;
  trains: CompactTraTrain[];
}

let traDailyIndexCache: TraDailyIndex | null = null;
let traDailyInFlight: Promise<TraDailyIndex | null> | null = null;

async function getTraDailyIndex(dateStr: string): Promise<TraDailyIndex | null> {
  if (
    traDailyIndexCache &&
    traDailyIndexCache.dateStr === dateStr &&
    Date.now() < traDailyIndexCache.expiresAt
  ) {
    return traDailyIndexCache;
  }

  if (traDailyInFlight) return traDailyInFlight;

  traDailyInFlight = (async () => {
    try {
      const res = await fetchTdx<{
        TrainDate?: string;
        TrainTimetables?: TdxTraDailyTimetableItem[];
      }>('/v3/Rail/TRA/DailyTrainTimetable/Today?%24format=JSON', 14400);

      const list = Array.isArray(res?.TrainTimetables) ? res.TrainTimetables : [];
      if (list.length === 0) return traDailyIndexCache;

      const byStation = new Map<string, CompactTraBoardStop[]>();
      const trains: CompactTraTrain[] = [];

      for (const item of list) {
        if (item.TrainInfo?.SuspendedFlag === 1) continue;
        const rawStops = Array.isArray(item.StopTimes) ? item.StopTimes : [];
        const activeStops = rawStops.filter((s) => s.SuspendedFlag !== 1);
        if (activeStops.length === 0) continue;

        const trainNo = item.TrainInfo.TrainNo;
        const trainType = normalizeTraType(item.TrainInfo.TrainTypeName?.Zh_tw);
        const direction: 0 | 1 = item.TrainInfo.Direction === 1 ? 1 : 0;
        const originStation =
          item.TrainInfo.StartingStationName?.Zh_tw ||
          activeStops[0]?.StationName?.Zh_tw ||
          '';
        const destinationStation =
          item.TrainInfo.EndingStationName?.Zh_tw ||
          activeStops[activeStops.length - 1]?.StationName?.Zh_tw ||
          '終點站';

        const mappedStops = activeStops.map((s) => ({
          stationId: s.StationID,
          stationName: s.StationName?.Zh_tw || s.StationID,
          arrivalTime: (s.ArrivalTime || s.DepartureTime || '--:--').slice(0, 5),
          departureTime: (s.DepartureTime || s.ArrivalTime || '--:--').slice(0, 5),
        }));

        trains.push({
          trainNo,
          trainType,
          direction,
          stops: mappedStops,
        });

        for (let idx = 0; idx < mappedStops.length; idx++) {
          const s = mappedStops[idx];
          const remaining = mappedStops.slice(idx + 1).map((r) => ({
            stationId: r.stationId,
            arrivalTime: r.arrivalTime,
          }));
          const curCoord = getTraStationCoord(s.stationId);
          const nextCoord =
            remaining.length > 0 ? getTraStationCoord(remaining[0].stationId) : null;
          const prevCoord =
            idx > 0 ? getTraStationCoord(mappedStops[idx - 1].stationId) : null;

          let bound: 'north' | 'south' = direction === 0 ? 'north' : 'south';
          if (curCoord && nextCoord) {
            bound = nextCoord[0] >= curCoord[0] ? 'north' : 'south';
          } else if (curCoord && prevCoord) {
            bound = curCoord[0] >= prevCoord[0] ? 'north' : 'south';
          }

          let arrList = byStation.get(s.stationId);
          if (!arrList) {
            arrList = [];
            byStation.set(s.stationId, arrList);
          }
          arrList.push({
            trainNo,
            trainType,
            direction,
            bound,
            originStation,
            destinationStation,
            departureTime: s.departureTime,
            arrivalTime: s.arrivalTime,
            remainingStops: remaining,
          });
        }
      }

      for (const arrList of byStation.values()) {
        arrList.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
      }

      traDailyIndexCache = {
        dateStr: res?.TrainDate || dateStr,
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
        byStation,
        trains,
      };
      return traDailyIndexCache;
    } catch {
      return traDailyIndexCache;
    } finally {
      traDailyInFlight = null;
    }
  })();

  return traDailyInFlight;
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
  sourceUpdatedAt: number;
  source: DataSourceMode;
}> {
  const { dateStr, timeStr, hhmm } = getTaipeiNow();

  if (!isTdxConfigured()) {
    return {
      trains: [],
      liveVehicles: [],
      updatedAt: timeStr,
      sourceUpdatedAt: Date.now(),
      source: 'tdx',
    };
  }

  const [liveRes, boardRes, dailyIndex] = await Promise.allSettled([
    fetchTdx<{ UpdateTime?: string; SrcUpdateTime?: string; TrainLiveBoards?: TdxTraTrainLive[] }>(
      '/v3/Rail/TRA/TrainLiveBoard?%24format=JSON',
      15
    ),
    fetchTdx<{ UpdateTime?: string; SrcUpdateTime?: string; StationLiveBoards?: TdxTraStationBoard[] }>(
      '/v3/Rail/TRA/StationLiveBoard?%24format=JSON',
      15
    ),
    getTraDailyIndex(dateStr),
  ]);

  const liveList =
    liveRes.status === 'fulfilled' && Array.isArray(liveRes.value?.TrainLiveBoards)
      ? liveRes.value.TrainLiveBoards
      : [];
  const stationBoardAll =
    boardRes.status === 'fulfilled' && Array.isArray(boardRes.value?.StationLiveBoards)
      ? boardRes.value.StationLiveBoards
      : [];
  const index = dailyIndex.status === 'fulfilled' ? dailyIndex.value : null;

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

  for (const sb of stationBoardAll) {
    if (sb.DelayTime !== undefined && !delayMap.has(sb.TrainNo)) {
      delayMap.set(sb.TrainNo, sb.DelayTime);
    }
  }

  let trains: TraTrainRow[] = [];

  if (mode === 'board') {
    const stationSchedules = index?.byStation.get(station) ?? [];
    const pickBound = (bound: 'north' | 'south'): TraTrainRow[] => {
      const boundAll = stationSchedules.filter((s) => s.bound === bound);
      const upcoming = boundAll.filter((s) => s.departureTime >= hhmm);
      const chosen = (upcoming.length > 0 ? upcoming : boundAll).slice(0, 24);
      return chosen.map((s) => {
        const delay = delayMap.get(s.trainNo) ?? 0;
        return {
          trainNo: s.trainNo,
          trainType: s.trainType,
          direction: s.direction,
          bound: s.bound,
          originStation: s.originStation,
          destinationStation: s.destinationStation,
          departureTime: s.departureTime,
          arrivalTime: s.arrivalTime,
          durationMinutes: 0,
          delayMinutes: delay,
          statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
          remainingStops: s.remainingStops,
        };
      });
    };

    trains = [...pickBound('north'), ...pickBound('south')];

    if (trains.length === 0) {
      trains = stationBoardAll
        .filter((r) => !r.StationID || r.StationID === station)
        .map((r) => {
          const delay = r.DelayTime ?? delayMap.get(r.TrainNo) ?? 0;
          return {
            trainNo: r.TrainNo,
            trainType: normalizeTraType(r.TrainTypeName?.Zh_tw),
            direction: (r.Direction === 1 ? 1 : 0) as 0 | 1,
            originStation: '',
            destinationStation: r.EndingStationName?.Zh_tw || '終點站',
            departureTime: (r.ScheduleDepartureTime || r.ScheduleArrivalTime || '--:--').slice(0, 5),
            arrivalTime: (r.ScheduleArrivalTime || '--:--').slice(0, 5),
            durationMinutes: 0,
            delayMinutes: delay,
            statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
          };
        });
    }
  } else if (index) {
    const mapped: TraTrainRow[] = [];
    for (const tr of index.trains) {
      const fromIdx = tr.stops.findIndex((s) => s.stationId === from);
      if (fromIdx === -1) continue;
      const toIdx = tr.stops.findIndex((s, i) => i > fromIdx && s.stationId === to);
      if (toIdx === -1) continue;
      const s0 = tr.stops[fromIdx];
      const s1 = tr.stops[toIdx];
      let dur = parseHhmmToMinutes(s1.arrivalTime) - parseHhmmToMinutes(s0.departureTime);
      if (dur < 0) dur += 1440;
      const delay = delayMap.get(tr.trainNo) ?? 0;
      mapped.push({
        trainNo: tr.trainNo,
        trainType: tr.trainType,
        direction: tr.direction,
        originStation: s0.stationName,
        destinationStation: s1.stationName,
        departureTime: s0.departureTime,
        arrivalTime: s1.arrivalTime,
        durationMinutes: dur,
        delayMinutes: delay,
        statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
      });
    }
    mapped.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    const upcoming = mapped.filter((t) => t.departureTime >= hhmm);
    trains = (upcoming.length > 0 ? upcoming : mapped).slice(0, 20);
  }

  const sourceUpdatedAt =
    liveRes.status === 'fulfilled'
      ? parseSourceTimeMs(liveRes.value?.SrcUpdateTime || liveRes.value?.UpdateTime)
      : Date.now();

  return {
    trains,
    liveVehicles,
    updatedAt: timeStr,
    sourceUpdatedAt,
    source: 'tdx',
  };
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
  sourceUpdatedAt: number;
  source: DataSourceMode;
}> {
  const { timeStr, hhmm, minutesOfDay } = getTaipeiNow();

  if (!isTdxConfigured()) {
    return {
      trains: [],
      liveVehicles: [],
      updatedAt: timeStr,
      sourceUpdatedAt: Date.now(),
      source: 'tdx',
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
      sourceUpdatedAt: Date.now(),
      source: 'tdx',
    };
  } catch {
    return {
      trains: [],
      liveVehicles: [],
      updatedAt: timeStr,
      sourceUpdatedAt: Date.now(),
      source: 'tdx',
    };
  }
}
