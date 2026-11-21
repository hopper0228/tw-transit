export type DepartureWindowMode = 'now30' | 'custom30' | 'all';

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

export function getDefaultTaipeiHhmm(): string {
  const mins = getCurrentTaipeiMinutes(Date.now());
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 依指定發車時間窗過濾班次（預設顯示基準時間起 30 分鐘內）
 */
export function filterByDepartureWindow<
  T extends { departureTime: string; delayMinutes?: number }
>(
  list: T[],
  mode: DepartureWindowMode,
  customTime: string,
  nowMs: number
): T[] {
  if (mode === 'all') return list;

  let baseMin = getCurrentTaipeiMinutes(nowMs);
  if (mode === 'custom30' && customTime.includes(':')) {
    const [ch, cm] = customTime.split(':').map(Number);
    if (Number.isFinite(ch) && Number.isFinite(cm)) {
      baseMin = ch * 60 + cm;
    }
  }

  return list.filter((t) => {
    const [hh, mm] = t.departureTime.split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
    let depMin = hh * 60 + mm + (t.delayMinutes || 0);
    if (baseMin > 1200 && depMin < 180) depMin += 1440;
    return depMin >= baseMin && depMin <= baseMin + 30;
  });
}
