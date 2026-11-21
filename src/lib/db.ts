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
    await sql`
      CREATE TABLE IF NOT EXISTS parking_lots_static (
        car_park_id TEXT PRIMARY KEY,
        city TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        total_spaces INT NOT NULL DEFAULT 0,
        fare_description TEXT NOT NULL DEFAULT '依現場公告',
        parking_type TEXT NOT NULL DEFAULT '立體',
        updated_at_label TEXT NOT NULL DEFAULT '依現場為準',
        service_date TEXT NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_parking_lots_lat_lng
      ON parking_lots_static (lat, lng)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS youbike_stations_static (
        station_uid TEXT PRIMARY KEY,
        city TEXT NOT NULL,
        station_name TEXT NOT NULL,
        address TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        total_docks INT NOT NULL DEFAULT 0,
        service_status INT NOT NULL DEFAULT 1,
        service_date TEXT NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_youbike_stations_lat_lng
      ON youbike_stations_static (lat, lng)
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

export interface SpatialParkingRow {
  carParkId: string;
  city: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  totalSpaces: number;
  fareDescription: string;
  parkingType: '平面' | '立體' | '地下';
  updatedAt: string;
}

export async function upsertParkingLotsToDb(
  lots: SpatialParkingRow[],
  serviceDate: string
): Promise<void> {
  if (!isDbConfigured() || lots.length === 0) return;
  await ensureStaticTables();
  const sql = getSql();
  const BATCH = 2500;
  for (let i = 0; i < lots.length; i += BATCH) {
    const chunk = lots.slice(i, i + BATCH);
    const ids = chunk.map((l) => l.carParkId);
    const cities = chunk.map((l) => l.city);
    const names = chunk.map((l) => l.name);
    const addrs = chunk.map((l) => l.address);
    const lats = chunk.map((l) => l.lat);
    const lngs = chunk.map((l) => l.lng);
    const totals = chunk.map((l) => Math.max(0, Math.round(l.totalSpaces || 0)));
    const fares = chunk.map((l) => l.fareDescription || '依現場公告');
    const types = chunk.map((l) => l.parkingType || '立體');
    const labels = chunk.map((l) => l.updatedAt || '依現場為準');
    const dates = chunk.map(() => serviceDate);

    await sql`
      INSERT INTO parking_lots_static (
        car_park_id, city, name, address, lat, lng,
        total_spaces, fare_description, parking_type, updated_at_label, service_date
      )
      SELECT id, c, n, a, la, ln, tot, f, tp, lb, d
      FROM UNNEST(
        ${ids}::text[], ${cities}::text[], ${names}::text[], ${addrs}::text[],
        ${lats}::double precision[], ${lngs}::double precision[],
        ${totals}::int[], ${fares}::text[], ${types}::text[], ${labels}::text[], ${dates}::text[]
      ) AS t(id, c, n, a, la, ln, tot, f, tp, lb, d)
      ON CONFLICT (car_park_id) DO UPDATE SET
        city = EXCLUDED.city,
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        total_spaces = EXCLUDED.total_spaces,
        fare_description = EXCLUDED.fare_description,
        parking_type = EXCLUDED.parking_type,
        updated_at_label = EXCLUDED.updated_at_label,
        service_date = EXCLUDED.service_date
    `;
  }
}

export async function queryParkingLotsFromDb(params: {
  bounds?: { north: number; south: number; east: number; west: number };
  userPoint?: { lat: number; lng: number };
  maxDistanceMeters?: number;
  query?: string;
  limit: number;
}): Promise<SpatialParkingRow[] | null> {
  if (!isDbConfigured()) return null;
  try {
    await ensureStaticTables();
    const sql = getSql();

    let south = -90;
    let north = 90;
    let west = -180;
    let east = 180;
    let cLat = 25.0468;
    let cLng = 121.5171;

    if (params.bounds) {
      south = params.bounds.south;
      north = params.bounds.north;
      west = params.bounds.west;
      east = params.bounds.east;
      cLat = (north + south) / 2;
      cLng = (east + west) / 2;
    } else if (params.userPoint) {
      cLat = params.userPoint.lat;
      cLng = params.userPoint.lng;
      const radiusM = params.maxDistanceMeters || (params.query ? 50000 : 10000);
      const dLat = (radiusM / 111000) * 1.2;
      const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
      const dLng = dLat / cosLat;
      south = cLat - dLat;
      north = cLat + dLat;
      west = cLng - dLng;
      east = cLng + dLng;
    }

    const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
    const qLike = params.query ? `%${params.query}%` : '';

    const rows = (await sql`
      SELECT
        car_park_id AS "carParkId",
        city,
        name,
        address,
        lat,
        lng,
        total_spaces AS "totalSpaces",
        fare_description AS "fareDescription",
        parking_type AS "parkingType",
        updated_at_label AS "updatedAt"
      FROM parking_lots_static
      WHERE lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
        AND (${qLike} = '' OR name ILIKE ${qLike} OR address ILIKE ${qLike})
      ORDER BY ((lat - ${cLat}) * (lat - ${cLat}) + ((lng - ${cLng}) * ${cosLat}) * ((lng - ${cLng}) * ${cosLat})) ASC
      LIMIT ${Math.max(params.limit, 150)}
    `) as SpatialParkingRow[];

    if (rows.length === 0 && !params.query && !params.bounds && !params.maxDistanceMeters) {
      // 若資料表尚未建立資料，回傳 null 觸發既有備援
      const countRow = (await sql`SELECT 1 FROM parking_lots_static LIMIT 1`) as unknown[];
      if (countRow.length === 0) return null;
    }

    return rows;
  } catch {
    return null;
  }
}

export interface SpatialYouBikeRow {
  stationUid: string;
  city: string;
  stationName: string;
  address: string;
  lat: number;
  lng: number;
  totalDocks: number;
  serviceStatus: number;
}

export async function upsertYouBikeStationsToDb(
  stations: SpatialYouBikeRow[],
  serviceDate: string
): Promise<void> {
  if (!isDbConfigured() || stations.length === 0) return;
  await ensureStaticTables();
  const sql = getSql();
  const BATCH = 2500;
  for (let i = 0; i < stations.length; i += BATCH) {
    const chunk = stations.slice(i, i + BATCH);
    const uids = chunk.map((s) => s.stationUid);
    const cities = chunk.map((s) => s.city);
    const names = chunk.map((s) => s.stationName);
    const addrs = chunk.map((s) => s.address);
    const lats = chunk.map((s) => s.lat);
    const lngs = chunk.map((s) => s.lng);
    const docks = chunk.map((s) => Math.max(0, Math.round(s.totalDocks || 0)));
    const statuses = chunk.map((s) => (s.serviceStatus === 1 ? 1 : 0));
    const dates = chunk.map(() => serviceDate);

    await sql`
      INSERT INTO youbike_stations_static (
        station_uid, city, station_name, address, lat, lng,
        total_docks, service_status, service_date
      )
      SELECT u, c, n, a, la, ln, dk, st, d
      FROM UNNEST(
        ${uids}::text[], ${cities}::text[], ${names}::text[], ${addrs}::text[],
        ${lats}::double precision[], ${lngs}::double precision[],
        ${docks}::int[], ${statuses}::int[], ${dates}::text[]
      ) AS t(u, c, n, a, la, ln, dk, st, d)
      ON CONFLICT (station_uid) DO UPDATE SET
        city = EXCLUDED.city,
        station_name = EXCLUDED.station_name,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        total_docks = EXCLUDED.total_docks,
        service_status = EXCLUDED.service_status,
        service_date = EXCLUDED.service_date
    `;
  }
}

export async function queryYouBikeStationsFromDb(params: {
  bounds?: { north: number; south: number; east: number; west: number };
  userPoint?: { lat: number; lng: number };
  maxDistanceMeters?: number;
  query?: string;
  limit: number;
}): Promise<SpatialYouBikeRow[] | null> {
  if (!isDbConfigured()) return null;
  try {
    await ensureStaticTables();
    const sql = getSql();

    let south = -90;
    let north = 90;
    let west = -180;
    let east = 180;
    let cLat = 25.0468;
    let cLng = 121.5171;

    if (params.bounds) {
      south = params.bounds.south;
      north = params.bounds.north;
      west = params.bounds.west;
      east = params.bounds.east;
      cLat = (north + south) / 2;
      cLng = (east + west) / 2;
    } else if (params.userPoint) {
      cLat = params.userPoint.lat;
      cLng = params.userPoint.lng;
      const radiusM = params.maxDistanceMeters || (params.query ? 50000 : 10000);
      const dLat = (radiusM / 111000) * 1.2;
      const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
      const dLng = dLat / cosLat;
      south = cLat - dLat;
      north = cLat + dLat;
      west = cLng - dLng;
      east = cLng + dLng;
    }

    const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
    const qLike = params.query ? `%${params.query}%` : '';

    const rows = (await sql`
      SELECT
        station_uid AS "stationUid",
        city,
        station_name AS "stationName",
        address,
        lat,
        lng,
        total_docks AS "totalDocks",
        service_status AS "serviceStatus"
      FROM youbike_stations_static
      WHERE lat BETWEEN ${south} AND ${north}
        AND lng BETWEEN ${west} AND ${east}
        AND (${qLike} = '' OR station_name ILIKE ${qLike} OR address ILIKE ${qLike})
      ORDER BY ((lat - ${cLat}) * (lat - ${cLat}) + ((lng - ${cLng}) * ${cosLat}) * ((lng - ${cLng}) * ${cosLat})) ASC
      LIMIT ${Math.max(params.limit, 150)}
    `) as SpatialYouBikeRow[];

    if (rows.length === 0 && !params.query && !params.bounds && !params.maxDistanceMeters) {
      const countRow = (await sql`SELECT 1 FROM youbike_stations_static LIMIT 1`) as unknown[];
      if (countRow.length === 0) return null;
    }

    return rows;
  } catch {
    return null;
  }
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
