import { METRO_SYSTEMS } from './mock-data';
import { getMetroStationCoord, getThsrStationCoord, getTraStationCoord } from './rail-geo';
import { fetchTdx, isTdxConfigured } from './tdx-client';
import {
  DataSourceMode,
  LiveRailVehicle,
  MetroPlatformArrival,
  MetroStationDetail,
  MetroSystemSnapshot,
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

async function getMetroSystemTables(
  sysId: string
): Promise<Map<string, CompactMetroTable[]>> {
  const now = Date.now();
  const cached = metroScheduleIndexCache.get(sysId);
  if (cached && cached.expiresAt > now) {
    return cached.byStation;
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
  return byStation;
}

const BRANCH_END_TERMINALS = new Set(['R22A', 'G03A', 'O54', 'O21', 'V11', 'V26']);
const LOOP_METRO_LINES = new Set(['C']);

function resolveTerminalFlags(
  lineCode: string,
  stationId: string,
  stationIdx: number,
  stationCount: number
) {
  if (LOOP_METRO_LINES.has(lineCode)) {
    return { isStartTerminal: false, isEndTerminal: false };
  }
  const isStartTerminal = stationIdx === 0;
  const isEndTerminal =
    stationIdx === stationCount - 1 || BRANCH_END_TERMINALS.has(stationId);
  return { isStartTerminal, isEndTerminal };
}

function buildEmptyMetroPlatforms(
  lineCode: string,
  stationId: string,
  terminals: [string, string],
  stationIdx: number,
  stationCount: number
): MetroPlatformArrival[] {
  const { isStartTerminal, isEndTerminal } = resolveTerminalFlags(
    lineCode,
    stationId,
    stationIdx,
    stationCount
  );
  const res: MetroPlatformArrival[] = [];
  if (!isEndTerminal) {
    res.push({
      platformName: '第 1 月台',
      destination: `往 ${terminals[1]}`,
      nextTrainSeconds: -1,
      followingTrainSeconds: 0,
    });
  }
  if (!isStartTerminal) {
    res.push({
      platformName: isEndTerminal ? '第 1 月台' : '第 2 月台',
      destination: `往 ${terminals[0]}`,
      nextTrainSeconds: -1,
      followingTrainSeconds: 0,
    });
  }
  return res;
}

function buildMetroLineVehicles(
  sysId: string,
  sysName: string,
  line: (typeof METRO_SYSTEMS)[number]['lines'][number],
  list: TdxMetroLiveBoard[]
): LiveRailVehicle[] {
  const lineStationIds = new Set(line.stations.map((s) => s.id));
  const lineRows = list.filter(
    (r) =>
      lineStationIds.has(r.StationID) ||
      r.LineID === line.code ||
      r.LineNO === line.code
  );

  const liveVehicles: LiveRailVehicle[] = [];
  const seenKeys = new Set<string>();
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
    const stations = line.stations;
    const destIdx = stations.findIndex((s) => destName.includes(s.name));
    const isReverse = destIdx === 0;
    const ordered = isReverse ? [...stations].reverse() : stations;

    for (let i = 0; i < ordered.length; i++) {
      const st = ordered[i];
      const row = stMap.get(st.id);
      if (!row || row.EstimateTime === undefined || row.EstimateTime > 2) continue;

      const coord = getMetroStationCoord(sysId, st.id);
      if (!coord) continue;

      let lat = coord[0];
      let lng = coord[1];
      const est = row.EstimateTime;

      if (est > 0 && i > 0) {
        const prevSt = ordered[i - 1];
        const prevRow = stMap.get(prevSt.id);
        const prevCoord = getMetroStationCoord(sysId, prevSt.id);
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
        id: `metro-live-${sysId}-${line.code}-${destName}-${st.id}`,
        label: `${isReverse ? '←' : '→'} ${st.name}`,
        title: `${sysName} ${line.name} (${dirLabel})`,
        subtitle:
          est === 0
            ? `進站中：${st.name}站`
            : `約 ${est} 分鐘抵達 ${st.name}站`,
        lat,
        lng,
        color: line.color,
      });
    }
  }

  return liveVehicles;
}

function buildMetroStationPlatforms(
  line: (typeof METRO_SYSTEMS)[number]['lines'][number],
  stationId: string,
  stationIdx: number,
  stationRows: TdxMetroLiveBoard[],
  ttList: CompactMetroTable[],
  minutesOfDay: number,
  weekday: string,
  snapshotCreatedAt: number
): MetroPlatformArrival[] {
  const stations = line.stations;
  const { isStartTerminal, isEndTerminal } = resolveTerminalFlags(
    line.code,
    stationId,
    stationIdx,
    stations.length
  );

  const resolveDirByDest = (
    destId?: string,
    destName?: string
  ): 'fwd' | 'rev' | null => {
    const name = destName || '';
    // 信義線東延段 R01 廣慈/奉天宮 位於 R02 象山以東（index -1），屬往象山方向
    if (line.code === 'R' && (destId === 'R01' || name.includes('廣慈'))) {
      return 'rev';
    }
    if (line.code === 'R' && stationId === 'R22A' && (destId === 'R22' || name.includes('北投'))) {
      return 'rev';
    }
    if (line.code === 'G' && stationId === 'G03A' && (destId === 'G03' || name.includes('七張'))) {
      return 'rev';
    }
    if (line.code === 'O') {
      if (name.includes('南勢角') || destId === 'O01') return 'rev';
      if (name.includes('迴龍') || name.includes('蘆洲') || destId === 'O21' || destId === 'O54') {
        return 'fwd';
      }
    }
    if (line.code === 'V') {
      if (name.includes('紅樹林') || destId === 'V01') return 'rev';
      if (name.includes('崁頂') || name.includes('漁人碼頭') || destId === 'V11' || destId === 'V26') {
        return 'fwd';
      }
    }

    const dIdx = stations.findIndex(
      (s) => (destId && s.id === destId) || (name && name.includes(s.name))
    );
    if (dIdx >= 0 && stationIdx >= 0) {
      if (dIdx > stationIdx) return 'fwd';
      if (dIdx < stationIdx) return 'rev';
    }
    if (name.includes(line.terminals[1])) return 'fwd';
    if (name.includes(line.terminals[0])) return 'rev';
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
      const firstRow = validLive[0];
      const firstAgeSec = Math.max(
        0,
        Math.round(
          (snapshotCreatedAt -
            parseSourceTimeMs(firstRow.SrcUpdateTime || firstRow.UpdateTime)) /
            1000
        )
      );
      const firstMin = firstRow.EstimateTime!;
      const rawFirstSec = firstMin <= 0 ? 25 : firstMin * 60;
      const firstSec = Math.max(10, rawFirstSec - firstAgeSec);
      const specificDest =
        firstRow.DestinationStationName?.Zh_tw || defaultDest;

      let secondSec = 0;
      if (validLive[1]?.EstimateTime !== undefined) {
        const secondRow = validLive[1];
        const secondAgeSec = Math.max(
          0,
          Math.round(
            (snapshotCreatedAt -
              parseSourceTimeMs(secondRow.SrcUpdateTime || secondRow.UpdateTime)) /
              1000
          )
        );
        secondSec = Math.max(
          firstSec + 60,
          secondRow.EstimateTime! * 60 - secondAgeSec
        );
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
        nextTrainSeconds: Math.max(15, first.sec),
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

  const defaultRevDest =
    stationId === 'R22A'
      ? '北投'
      : stationId === 'G03A'
        ? '七張'
        : line.terminals[0];

  const platforms: MetroPlatformArrival[] = [];
  if (!isEndTerminal) {
    platforms.push(
      buildPlatform('第 1 月台', line.terminals[1], fwdRows, fwdUpcoming)
    );
  }
  if (!isStartTerminal) {
    platforms.push(
      buildPlatform(
        isEndTerminal ? '第 1 月台' : '第 2 月台',
        defaultRevDest,
        revRows,
        revUpcoming
      )
    );
  }
  return platforms;
}

/**
 * 一次取得單一捷運系統（如 TRTC）的全線即時快照，供前端換站零延遲過濾
 */
export async function getRealMetroSystemSnapshot(
  systemId: string
): Promise<MetroSystemSnapshot> {
  const sys = METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];
  const snapshotCreatedAt = Date.now();
  const { timeStr, minutesOfDay, weekday } = getTaipeiNow();

  const buildEmptySnapshot = (sourceUpdatedAt: number): MetroSystemSnapshot => {
    const stations: Record<string, MetroStationDetail> = {};
    const liveVehiclesByLine: Record<string, LiveRailVehicle[]> = {};
    for (const line of sys.lines) {
      liveVehiclesByLine[line.code] = [];
      line.stations.forEach((st, idx) => {
        stations[st.id] = {
          systemId: sys.id,
          systemName: sys.name,
          lineCode: line.code,
          lineName: line.name,
          lineColor: line.color,
          stationId: st.id,
          stationName: st.name,
          platforms: buildEmptyMetroPlatforms(
            line.code,
            st.id,
            line.terminals,
            idx,
            line.stations.length
          ),
          updatedAt: timeStr,
          sourceUpdatedAt,
          source: 'tdx',
        };
      });
    }
    return {
      systemId: sys.id,
      systemName: sys.name,
      stations,
      liveVehiclesByLine,
      updatedAt: timeStr,
      sourceUpdatedAt,
      source: 'tdx',
    };
  };

  if (!isTdxConfigured()) {
    return buildEmptySnapshot(snapshotCreatedAt);
  }

  try {
    // 冷啟動時依序暖機時刻表快取（6 小時有效），避免與 LiveBoard 併發觸發 TDX 429
    const byStationTables = await getMetroSystemTables(sys.id);
    const liveRaw = await fetchTdx<TdxMetroLiveBoard[]>(
      `/v2/Rail/Metro/LiveBoard/${sys.id}?%24format=JSON`,
      15
    ).catch(() => [] as TdxMetroLiveBoard[]);

    const list = Array.isArray(liveRaw) ? liveRaw : [];
    const rowsByStationId = new Map<string, TdxMetroLiveBoard[]>();
    const rowsByNameLine = new Map<string, TdxMetroLiveBoard[]>();

    for (const row of list) {
      if (row.StationID) {
        const arr = rowsByStationId.get(row.StationID) || [];
        arr.push(row);
        rowsByStationId.set(row.StationID, arr);
      }
      const stName = row.StationName?.Zh_tw;
      const lineKey = row.LineID || row.LineNO;
      if (stName && lineKey) {
        const key = `${stName}:${lineKey}`;
        const arr = rowsByNameLine.get(key) || [];
        arr.push(row);
        rowsByNameLine.set(key, arr);
      }
    }

    // 所有剩餘秒數皆已對齊快照建立時刻 snapshotCreatedAt，避免前端重複扣減 LiveBoard 延遲
    const sourceUpdatedAt = snapshotCreatedAt;

    const stations: Record<string, MetroStationDetail> = {};
    const liveVehiclesByLine: Record<string, LiveRailVehicle[]> = {};

    for (const line of sys.lines) {
      liveVehiclesByLine[line.code] = buildMetroLineVehicles(
        sys.id,
        sys.name,
        line,
        list
      );
      line.stations.forEach((st, idx) => {
        const stationRows =
          rowsByStationId.get(st.id) ??
          rowsByNameLine.get(`${st.name}:${line.code}`) ??
          [];
        const ttList = byStationTables.get(st.id) || [];
        const platforms = buildMetroStationPlatforms(
          line,
          st.id,
          idx,
          stationRows,
          ttList,
          minutesOfDay,
          weekday,
          snapshotCreatedAt
        );
        stations[st.id] = {
          systemId: sys.id,
          systemName: sys.name,
          lineCode: line.code,
          lineName: line.name,
          lineColor: line.color,
          stationId: st.id,
          stationName: st.name,
          platforms,
          updatedAt: timeStr,
          sourceUpdatedAt,
          source: 'tdx',
        };
      });
    }

    return {
      systemId: sys.id,
      systemName: sys.name,
      stations,
      liveVehiclesByLine,
      updatedAt: timeStr,
      sourceUpdatedAt,
      source: 'tdx',
    };
  } catch {
    return buildEmptySnapshot(Date.now());
  }
}

export async function getRealMetroStation(
  systemId: string,
  stationId: string
): Promise<MetroStationDetail> {
  const snapshot = await getRealMetroSystemSnapshot(systemId);
  const sys = METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];
  const fallbackStation = sys.lines[0].stations[0];
  const detail = snapshot.stations[stationId] || snapshot.stations[fallbackStation.id];
  return {
    ...detail,
    liveVehicles: snapshot.liveVehiclesByLine[detail.lineCode] || [],
  };
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
    WheelchairFlag?: number;
    BikeFlag?: number;
    BreastFeedingFlag?: number;
    Note?: string;
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
  note?: string;
  wheelchairFlag?: boolean;
  bikeFlag?: boolean;
  breastFeedingFlag?: boolean;
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
  trainByNo: Map<string, CompactTraTrain>;
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
      const trainByNo = new Map<string, CompactTraTrain>();

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

        const trainEntry: CompactTraTrain = {
          trainNo,
          trainType,
          direction,
          note: item.TrainInfo.Note?.trim() || undefined,
          wheelchairFlag: item.TrainInfo.WheelchairFlag === 1,
          bikeFlag: item.TrainInfo.BikeFlag === 1,
          breastFeedingFlag: item.TrainInfo.BreastFeedingFlag === 1,
          stops: mappedStops,
        };
        trains.push(trainEntry);
        trainByNo.set(trainNo, trainEntry);

        for (let idx = 0; idx < mappedStops.length; idx++) {
          const s = mappedStops[idx];
          const remaining = mappedStops.slice(idx + 1).map((r) => ({
            stationId: r.stationId,
            arrivalTime: r.arrivalTime,
          }));
          const bound = resolveTraBound(s.stationId, direction);

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
        trainByNo,
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

function resolveTraBound(stationId: string, direction: 0 | 1): 'north' | 'south' {
  // 東部幹線 / 宜蘭線 / 北迴線 (6xxx, 7xxx)：逆行(1)為北上往臺北，順行(0)為南下往花東
  const isEast = stationId.startsWith('6') || stationId.startsWith('7');
  if (isEast) {
    return direction === 1 ? 'north' : 'south';
  }
  // 西部幹線 / 南迴線 (09xx-5xxx)：順行(0)為北上往基隆，逆行(1)為南下往高屏
  return direction === 0 ? 'north' : 'south';
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

  // 冷啟動時先取得當日全線時刻表索引，避免與 TrainLiveBoard 併發觸發 TDX 429
  const dailyIndexValue = await getTraDailyIndex(dateStr);
  const dailyIndex: PromiseSettledResult<Awaited<ReturnType<typeof getTraDailyIndex>>> = {
    status: 'fulfilled',
    value: dailyIndexValue,
  };
  const [liveRes] = await Promise.allSettled([
    fetchTdx<{ UpdateTime?: string; SrcUpdateTime?: string; TrainLiveBoards?: TdxTraTrainLive[] }>(
      '/v3/Rail/TRA/TrainLiveBoard?%24format=JSON',
      15
    ),
  ]);

  const liveList =
    liveRes.status === 'fulfilled' && Array.isArray(liveRes.value?.TrainLiveBoards)
      ? liveRes.value.TrainLiveBoards
      : [];
  const index = dailyIndex.status === 'fulfilled' ? dailyIndex.value : null;

  const delayMap = new Map<string, number>();
  const liveLocMap = new Map<string, string>();
  const liveStationIdMap = new Map<string, string>();
  const liveVehicles: LiveRailVehicle[] = [];

  for (const item of liveList) {
    delayMap.set(item.TrainNo, item.DelayTime ?? 0);
    liveStationIdMap.set(item.TrainNo, item.StationID);
    const statusLabel =
      item.TrainStationStatus === 0
        ? '進站中'
        : item.TrainStationStatus === 1
          ? '已到站'
          : '已發車';
    liveLocMap.set(
      item.TrainNo,
      `${item.StationName?.Zh_tw || item.StationID}（${statusLabel}）`
    );
    const coord = getTraStationCoord(item.StationID);
    if (!coord) continue;
    const tType = normalizeTraType(item.TrainTypeName?.Zh_tw);
    const delay = item.DelayTime ?? 0;
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
    const stationSchedules = index?.byStation.get(station) ?? [];
    const pickBound = (bound: 'north' | 'south'): TraTrainRow[] => {
      const chosen = stationSchedules.filter((s) => s.bound === bound);
      return chosen.map((s) => {
        const delay = delayMap.get(s.trainNo) ?? 0;
        const meta = index?.trainByNo.get(s.trainNo);
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
          currentStationId: liveStationIdMap.get(s.trainNo),
          currentLocation: liveLocMap.get(s.trainNo),
          note: meta?.note,
          wheelchairFlag: meta?.wheelchairFlag,
          bikeFlag: meta?.bikeFlag,
          breastFeedingFlag: meta?.breastFeedingFlag,
          remainingStops: s.remainingStops,
          fullStops: meta?.stops,
        };
      });
    };

    trains = [...pickBound('north'), ...pickBound('south')];

    // 若全線時刻表因 TDX 429 暫時無法取得，降級改用該站即時電子看板作為備援，避免回傳空陣列
    if (trains.length === 0 && !index) {
      try {
        const boardRes = await fetchTdx<{ StationLiveBoards?: TdxTraStationBoard[] }>(
          `/v3/Rail/TRA/StationLiveBoard/Station/${encodeURIComponent(station)}?%24format=JSON`,
          20
        );
        const rows = Array.isArray(boardRes?.StationLiveBoards) ? boardRes.StationLiveBoards : [];
        trains = rows.map((item) => {
          const direction = (item.Direction === 1 ? 1 : 0) as 0 | 1;
          const delay = item.DelayTime ?? delayMap.get(item.TrainNo) ?? 0;
          const dep = (item.ScheduleDepartureTime || item.ScheduleArrivalTime || '').slice(0, 5);
          const arr = (item.ScheduleArrivalTime || item.ScheduleDepartureTime || '').slice(0, 5);
          return {
            trainNo: item.TrainNo,
            trainType: normalizeTraType(item.TrainTypeName?.Zh_tw),
            direction,
            bound: resolveTraBound(station, direction),
            originStation: '',
            destinationStation: item.EndingStationName?.Zh_tw || '',
            departureTime: dep,
            arrivalTime: arr,
            durationMinutes: 0,
            delayMinutes: delay,
            statusText: delay > 0 ? `晚 ${delay} 分` : '準點',
          };
        });
      } catch {
        // 備援亦失敗時維持空陣列
      }
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
  to?: string
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
    // 冷啟動時先取得並快取當日高鐵時刻表（3600s + Vercel Data Cache 跨實例共享），避免與餘位 API 併發觸發 TDX 429
    const daily = await fetchTdx<TdxThsrDaily[]>(
      '/v2/Rail/THSR/DailyTimetable/Today?%24format=JSON',
      3600,
      true
    );
    const seatData = await fetchTdx<TdxThsrSeatList>(
      `/v2/Rail/THSR/AvailableSeatStatusList/${encodeURIComponent(from)}?%24format=JSON`,
      60
    ).catch(() => ({ AvailableSeats: [] }));

    const seatByTrainStop = new Map<
      string,
      Map<string, { std: 'available' | 'limited' | 'full'; biz: 'available' | 'limited' | 'full' }>
    >();
    for (const s of seatData?.AvailableSeats || []) {
      const stMap = new Map<
        string,
        { std: 'available' | 'limited' | 'full'; biz: 'available' | 'limited' | 'full' }
      >();
      for (const st of s.StopStations || []) {
        stMap.set(st.StationID, {
          std: mapSeatCode(st.StandardSeatStatus),
          biz: mapSeatCode(st.BusinessSeatStatus),
        });
      }
      seatByTrainStop.set(s.TrainNo, stMap);
    }

    const dailyList = Array.isArray(daily) ? daily : [];
    const matchedTrains: ThsrTrainRow[] = [];
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

      // 2. 篩選停靠出發站的班次（含北上/南下與下游停靠站供前端 0ms 篩選）
      const fromIdx = stops.findIndex((s) => s.StationID === from);
      if (fromIdx < 0 || fromIdx >= stops.length - 1) continue;

      const isNorth =
        item.DailyTrainInfo.Direction === 1 ||
        Number(stops[stops.length - 1].StationID) < Number(stops[0].StationID);
      const direction: 0 | 1 = isNorth ? 1 : 0;
      const bound: 'north' | 'south' = isNorth ? 'north' : 'south';
      const trainSeatMap = seatByTrainStop.get(item.DailyTrainInfo.TrainNo);
      const sFrom = stops[fromIdx];

      if (to) {
        const toIdx = stops.findIndex((s, idx) => idx > fromIdx && s.StationID === to);
        if (toIdx === -1) continue;
        const sTo = stops[toIdx];
        let dur = parseHhmmToMinutes(sTo.ArrivalTime) - parseHhmmToMinutes(sFrom.DepartureTime);
        if (dur < 0) dur += 1440;
        const seats = trainSeatMap?.get(to);
        const stopCount = toIdx - fromIdx;
        const stopPattern: ThsrTrainRow['stopPattern'] =
          stopCount <= 2 ? '直達' : stopCount <= 5 ? '跳蛙' : '站站停';

        matchedTrains.push({
          trainNo: item.DailyTrainInfo.TrainNo,
          direction,
          bound,
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
      } else {
        const sEnd = stops[stops.length - 1];
        let dur = parseHhmmToMinutes(sEnd.ArrivalTime) - parseHhmmToMinutes(sFrom.DepartureTime);
        if (dur < 0) dur += 1440;
        const stopCount = stops.length - 1 - fromIdx;
        const stopPattern: ThsrTrainRow['stopPattern'] =
          stops.length <= 5 ? '直達' : stops.length <= 9 ? '跳蛙' : '站站停';
        const endSeats = trainSeatMap?.get(sEnd.StationID) ?? trainSeatMap?.get(stops[fromIdx + 1].StationID);
        const remainingStops = stops.slice(fromIdx + 1).map((st) => {
          const stSeats = trainSeatMap?.get(st.StationID);
          return {
            stationId: st.StationID,
            stationName: st.StationName?.Zh_tw || st.StationID,
            arrivalTime: st.ArrivalTime.slice(0, 5),
            standardSeatStatus: stSeats?.std ?? 'available',
            businessSeatStatus: stSeats?.biz ?? 'available',
          };
        });
        const fullStops = stops.map((st, idx) => {
          const stSeats = idx > fromIdx ? trainSeatMap?.get(st.StationID) : undefined;
          return {
            stationId: st.StationID,
            stationName: st.StationName?.Zh_tw || st.StationID,
            arrivalTime: (st.ArrivalTime || st.DepartureTime || '--:--').slice(0, 5),
            departureTime: (st.DepartureTime || st.ArrivalTime || '--:--').slice(0, 5),
            standardSeatStatus: stSeats?.std,
            businessSeatStatus: stSeats?.biz,
          };
        });
        const liveMatch = liveVehicles.find(
          (v) => v.id === `thsr-live-${item.DailyTrainInfo.TrainNo}`
        );
        void stopCount;

        matchedTrains.push({
          trainNo: item.DailyTrainInfo.TrainNo,
          direction,
          bound,
          originStation: sFrom.StationName?.Zh_tw || '',
          destinationStation:
            item.DailyTrainInfo.EndingStationName?.Zh_tw || sEnd.StationName?.Zh_tw || '',
          departureTime: sFrom.DepartureTime.slice(0, 5),
          arrivalTime: sEnd.ArrivalTime.slice(0, 5),
          durationMinutes: dur,
          stopPattern,
          standardSeatStatus: endSeats?.std ?? 'available',
          businessSeatStatus: endSeats?.biz ?? 'available',
          nonReservedCars: '10-12車',
          liveSubtitle: liveMatch?.subtitle?.replace('<br/>', ' · '),
          remainingStops,
          fullStops,
        });
      }
    }

    matchedTrains.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

    let trains: ThsrTrainRow[];
    if (to) {
      const upcoming = matchedTrains.filter((t) => t.departureTime >= hhmm);
      trains = (upcoming.length > 0 ? upcoming : matchedTrains).slice(0, 20);
    } else {
      const pickBound = (b: 'north' | 'south') =>
        matchedTrains.filter((t) => t.bound === b);
      trains = [...pickBound('north'), ...pickBound('south')];
    }

    return {
      trains,
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
