import { NextRequest, NextResponse } from 'next/server';
import { getStaticSyncStatus } from '@/lib/db';
import { syncOpenDataStaticToDb } from '@/lib/opendata-client';
import { syncDailyStaticToDb } from '@/lib/rail-live';

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
    const [rail, opendata] = await Promise.all([
      group === 'all' || group === 'rail'
        ? syncDailyStaticToDb()
        : Promise.resolve({}),
      group === 'all' || group === 'opendata'
        ? syncOpenDataStaticToDb()
        : Promise.resolve({}),
    ]);
    const status = await getStaticSyncStatus();
    return NextResponse.json(
      { ok: true, group, summary: { ...rail, ...opendata }, status },
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
