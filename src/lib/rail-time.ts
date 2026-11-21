export const HOURS_24 = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0')
);

export const MINUTES_15 = ['00', '15', '30', '45'] as const;

function getCurrentTaipeiMinutes(nowMs: number): number {
  const d = new Date(nowMs > 0 ? nowMs : Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? d.getHours());
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? d.getMinutes());
  return h * 60 + m;
}

/**
 * 取得包含目前時刻的前一個 15 分鐘整點（例如 11:47 -> 11 時 45 分）
 */
export function getDefaultTaipeiHourMinute15(): { hour: string; minute: string } {
  const mins = getCurrentTaipeiMinutes(Date.now());
  const h = Math.floor(mins / 60) % 24;
  const q = Math.floor((mins % 60) / 15) * 15;
  return {
    hour: String(h).padStart(2, '0'),
    minute: String(q).padStart(2, '0'),
  };
}

/**
 * 依指定 24 小時（小時＋每 15 分）篩選接下來 1 小時內的發車班次
 */
export function filterByDepartureWindow<
  T extends { departureTime: string; delayMinutes?: number }
>(list: T[], hour: string, minute: string): T[] {
  const ch = Number(hour);
  const cm = Number(minute);
  if (!Number.isFinite(ch) || !Number.isFinite(cm)) return list;
  const baseMin = ch * 60 + cm;

  return list.filter((t) => {
    const [hh, mm] = t.departureTime.split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
    let depMin = hh * 60 + mm + (t.delayMinutes || 0);
    if (baseMin > 1200 && depMin < 180) depMin += 1440;
    return depMin >= baseMin && depMin <= baseMin + 60;
  });
}

function parseHhmmMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

/**
 * 依各站時刻表與目前時間推算列車所在站點與狀態（已到站 / 已發車 / 尚未發車）
 */
export function resolveTrainStopPosition(
  stops: { stationId: string; arrivalTime: string; departureTime: string }[],
  nowMs: number,
  delayMinutes = 0
): { stationId: string; action: '已到站' | '已發車' | '尚未發車' } | null {
  if (!stops || stops.length === 0) return null;

  const nowMin = getCurrentTaipeiMinutes(nowMs);
  const firstDep = parseHhmmMin(stops[0].departureTime);
  if (firstDep < 0) return null;

  const adjNow = firstDep > 1200 && nowMin < 180 ? nowMin + 1440 : nowMin;
  const delay = Math.max(0, delayMinutes);

  if (adjNow < firstDep + delay) {
    return { stationId: stops[0].stationId, action: '尚未發車' };
  }

  for (let i = 0; i < stops.length; i++) {
    const cur = stops[i];
    let arr = parseHhmmMin(cur.arrivalTime);
    let dep = parseHhmmMin(cur.departureTime);
    if (arr < firstDep) arr += 1440;
    if (dep < arr) dep += 1440;
    arr += delay;
    dep += delay;

    if (adjNow >= arr && adjNow <= dep) {
      return { stationId: cur.stationId, action: '已到站' };
    }

    if (i < stops.length - 1) {
      let nextArr = parseHhmmMin(stops[i + 1].arrivalTime);
      if (nextArr < firstDep) nextArr += 1440;
      nextArr += delay;
      if (adjNow > dep && adjNow < nextArr) {
        return { stationId: cur.stationId, action: '已發車' };
      }
    }
  }

  return { stationId: stops[stops.length - 1].stationId, action: '已到站' };
}
