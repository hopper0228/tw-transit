import { NextRequest, NextResponse } from 'next/server';
import { getStaticSyncStatus } from '@/lib/db';
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
    const summary = await syncDailyStaticToDb();
    const status = await getStaticSyncStatus();
    return NextResponse.json(
      { ok: true, summary, status },
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
