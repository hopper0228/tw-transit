import { neon } from '@neondatabase/serverless';

function getConnectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function isDbConfigured(): boolean {
  return Boolean(getConnectionString());
}

function getSql() {
  const conn = getConnectionString();
  if (!conn) {
    throw new Error('DATABASE_URL / POSTGRES_URL is not configured');
  }
  return neon(conn);
}

let tablesReadyPromise: Promise<void> | null = null;

export async function ensureStaticTables(): Promise<void> {
  if (!isDbConfigured()) return;
  if (tablesReadyPromise) return tablesReadyPromise;

  tablesReadyPromise = (async () => {
    const sql = getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS tra_station_schedules (
        service_date TEXT NOT NULL,
        station_id TEXT NOT NULL,
        trains JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (service_date, station_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS tra_train_stops (
        service_date TEXT NOT NULL,
        train_no TEXT NOT NULL,
        meta JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (service_date, train_no)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS rail_daily_snapshots (
        cache_key TEXT PRIMARY KEY,
        service_date TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS static_sync_log (
        dataset_key TEXT PRIMARY KEY,
        service_date TEXT NOT NULL,
        record_count INT NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS bus_route_stops (
        city TEXT NOT NULL,
        route_id INT NOT NULL,
        dir0 JSONB NOT NULL,
        dir1 JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (city, route_id)
      )
    `;
  })().catch((err) => {
    tablesReadyPromise = null;
    throw err;
  });

  return tablesReadyPromise;
}

export async function getTraStationFromDb<T>(
  serviceDate: string,
  stationId: string
): Promise<T[] | null> {
  if (!isDbConfigured()) return null;
  try {
    await ensureStaticTables();
    const sql = getSql();
    const rows = (await sql`
      SELECT trains FROM tra_station_schedules
      WHERE service_date = ${serviceDate} AND station_id = ${stationId}
      LIMIT 1
    `) as Array<{ trains: T[] }>;
    return rows.length > 0 && Array.isArray(rows[0].trains) ? rows[0].trains : null;
  } catch {
    return null;
  }
}

export async function getTraTrainsFromDb<T>(
  serviceDate: string,
  trainNos: string[]
): Promise<Record<string, T>> {
  if (!isDbConfigured() || trainNos.length === 0) return {};
  try {
    await ensureStaticTables();
    const sql = getSql();
    const rows = (await sql`
      SELECT train_no, meta FROM tra_train_stops
      WHERE service_date = ${serviceDate} AND train_no = ANY(${trainNos})
    `) as Array<{ train_no: string; meta: T }>;
    const out: Record<string, T> = {};
    for (const row of rows) {
      out[row.train_no] = row.meta;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveTraDailyToDb(
  serviceDate: string,
  byStation: Map<string, unknown[]>,
  trains: Array<{ trainNo: string }>
): Promise<void> {
  if (!isDbConfigured()) return;
  await ensureStaticTables();
  const sql = getSql();

  const stationEntries = Array.from(byStation.entries());
  const STATION_BATCH = 100;
  for (let i = 0; i < stationEntries.length; i += STATION_BATCH) {
    const chunk = stationEntries.slice(i, i + STATION_BATCH);
    const dates = chunk.map(() => serviceDate);
    const stationIds = chunk.map(([stationId]) => stationId);
    const payloads = chunk.map(([, list]) => JSON.stringify(list));
    await sql`
      INSERT INTO tra_station_schedules (service_date, station_id, trains, updated_at)
      SELECT d, s, p::jsonb, NOW()
      FROM UNNEST(${dates}::text[], ${stationIds}::text[], ${payloads}::text[]) AS t(d, s, p)
      ON CONFLICT (service_date, station_id)
      DO UPDATE SET trains = EXCLUDED.trains, updated_at = NOW()
    `;
  }

  const TRAIN_BATCH = 350;
  for (let i = 0; i < trains.length; i += TRAIN_BATCH) {
    const chunk = trains.slice(i, i + TRAIN_BATCH);
    const dates = chunk.map(() => serviceDate);
    const trainNos = chunk.map((t) => t.trainNo);
    const metas = chunk.map((t) => JSON.stringify(t));
    await sql`
      INSERT INTO tra_train_stops (service_date, train_no, meta, updated_at)
      SELECT d, n, m::jsonb, NOW()
      FROM UNNEST(${dates}::text[], ${trainNos}::text[], ${metas}::text[]) AS t(d, n, m)
      ON CONFLICT (service_date, train_no)
      DO UPDATE SET meta = EXCLUDED.meta, updated_at = NOW()
    `;
  }

  await sql`
    INSERT INTO static_sync_log (dataset_key, service_date, record_count, synced_at)
    VALUES ('tra_daily', ${serviceDate}, ${trains.length}, NOW())
    ON CONFLICT (dataset_key)
    DO UPDATE SET service_date = EXCLUDED.service_date, record_count = EXCLUDED.record_count, synced_at = NOW()
  `;

  // 清除過期日期資料，確保免費 500MB 空間常保輕盈
  await sql`DELETE FROM tra_station_schedules WHERE service_date < ${serviceDate}`;
  await sql`DELETE FROM tra_train_stops WHERE service_date < ${serviceDate}`;
}

export async function getRailSnapshotFromDb<T>(
  cacheKey: string,
  serviceDate: string
): Promise<T | null> {
  if (!isDbConfigured()) return null;
  try {
    await ensureStaticTables();
    const sql = getSql();
    const rows = (await sql`
      SELECT payload FROM rail_daily_snapshots
      WHERE cache_key = ${cacheKey} AND service_date = ${serviceDate}
      LIMIT 1
    `) as Array<{ payload: T }>;
    return rows.length > 0 ? rows[0].payload : null;
  } catch {
    return null;
  }
}

export async function saveRailSnapshotToDb(
  cacheKey: string,
  datasetKey: string,
  serviceDate: string,
  payload: unknown,
  recordCount: number
): Promise<void> {
  if (!isDbConfigured()) return;
  await ensureStaticTables();
  const sql = getSql();
  const jsonText = JSON.stringify(payload);
  await sql`
    INSERT INTO rail_daily_snapshots (cache_key, service_date, payload, updated_at)
    VALUES (${cacheKey}, ${serviceDate}, ${jsonText}::jsonb, NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET service_date = EXCLUDED.service_date, payload = EXCLUDED.payload, updated_at = NOW()
  `;
  await sql`
    INSERT INTO static_sync_log (dataset_key, service_date, record_count, synced_at)
    VALUES (${datasetKey}, ${serviceDate}, ${recordCount}, NOW())
    ON CONFLICT (dataset_key)
    DO UPDATE SET service_date = EXCLUDED.service_date, record_count = EXCLUDED.record_count, synced_at = NOW()
  `;
  await sql`DELETE FROM rail_daily_snapshots WHERE service_date < ${serviceDate}`;
}

export async function getBusRouteStopsFromDb<T>(
  city: string,
  routeId: number
): Promise<{ dir0: T[]; dir1: T[] } | null> {
  if (!isDbConfigured()) return null;
  try {
    await ensureStaticTables();
    const sql = getSql();
    const rows = (await sql`
      SELECT dir0, dir1 FROM bus_route_stops
      WHERE city = ${city} AND route_id = ${routeId}
      LIMIT 1
    `) as Array<{ dir0: T[]; dir1: T[] }>;
    return rows.length > 0 ? { dir0: rows[0].dir0 || [], dir1: rows[0].dir1 || [] } : null;
  } catch {
    return null;
  }
}

export async function saveBusRouteStopsToDb(
  city: string,
  serviceDate: string,
  stopsMap: Map<number, { dir0: unknown[]; dir1: unknown[] }>
): Promise<void> {
  if (!isDbConfigured() || stopsMap.size === 0) return;
  await ensureStaticTables();
  const sql = getSql();

  const entries = Array.from(stopsMap.entries());
  const BATCH = 250;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const cities = chunk.map(() => city);
    const routeIds = chunk.map(([rid]) => rid);
    const dir0s = chunk.map(([, b]) => JSON.stringify(b.dir0));
    const dir1s = chunk.map(([, b]) => JSON.stringify(b.dir1));
    await sql`
      INSERT INTO bus_route_stops (city, route_id, dir0, dir1, updated_at)
      SELECT c, r, d0::jsonb, d1::jsonb, NOW()
      FROM UNNEST(${cities}::text[], ${routeIds}::int[], ${dir0s}::text[], ${dir1s}::text[]) AS t(c, r, d0, d1)
      ON CONFLICT (city, route_id)
      DO UPDATE SET dir0 = EXCLUDED.dir0, dir1 = EXCLUDED.dir1, updated_at = NOW()
    `;
  }

  await sql`
    INSERT INTO static_sync_log (dataset_key, service_date, record_count, synced_at)
    VALUES (${`bus_stops_${city.toLowerCase()}`}, ${serviceDate}, ${stopsMap.size}, NOW())
    ON CONFLICT (dataset_key)
    DO UPDATE SET service_date = EXCLUDED.service_date, record_count = EXCLUDED.record_count, synced_at = NOW()
  `;
}

export async function getStaticSyncStatus(): Promise<
  Array<{ dataset_key: string; service_date: string; record_count: number; synced_at: string }>
> {
  if (!isDbConfigured()) return [];
  try {
    await ensureStaticTables();
    const sql = getSql();
    return (await sql`
      SELECT dataset_key, service_date, record_count, synced_at::text
      FROM static_sync_log
      ORDER BY dataset_key ASC
    `) as Array<{
      dataset_key: string;
      service_date: string;
      record_count: number;
      synced_at: string;
    }>;
  } catch {
    return [];
  }
}
