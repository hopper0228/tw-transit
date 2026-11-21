import { NextRequest, NextResponse } from 'next/server';
import { getStaticSyncStatus } from '@/lib/db';
import {
  syncOpenDataStaticToDb,
  syncTdxBikeStaticToDb,
  syncTdxParkingStaticToDb,
} from '@/lib/opendata-client';
import { syncMetroStaticToDb, syncRailStaticToDb } from '@/lib/rail-live';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const group = req.nextUrl.searchParams.get('group') || 'all';
    const [rail, metro, opendata, tdxBike, tdxParking] = await Promise.all([
      group === 'all' || group === 'rail'
        ? syncRailStaticToDb()
        : Promise.resolve({}),
      group === 'all' || group === 'metro'
        ? syncMetroStaticToDb()
        : Promise.resolve({}),
      group === 'all' || group === 'opendata'
        ? syncOpenDataStaticToDb()
        : Promise.resolve({}),
      group === 'all' || group === 'tdx_bike'
        ? syncTdxBikeStaticToDb()
        : Promise.resolve({}),
      group === 'all' || group === 'tdx_parking'
        ? syncTdxParkingStaticToDb()
        : Promise.resolve({}),
    ]);
    const status = await getStaticSyncStatus();
    return NextResponse.json(
      {
        ok: true,
        group,
        summary: { ...rail, ...metro, ...opendata, ...tdxBike, ...tdxParking },
        status,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Static sync failed',
      },
      { status: 500 }
    );
  }
}
