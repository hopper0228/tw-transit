import { NextRequest, NextResponse } from 'next/server';
import { THSR_STATIONS } from '@/lib/mock-data';
import { getRealThsrData, getThsrTrainStops } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const modeParam = req.nextUrl.searchParams.get('mode');
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const trainNo = req.nextUrl.searchParams.get('trainNo') || '';

  if (modeParam === 'train' && trainNo) {
    const fullStops = await getThsrTrainStops(from, trainNo);
    const cacheHeader =
      fullStops.length > 0
        ? 'public, s-maxage=60, stale-while-revalidate=120'
        : 'no-store, max-age=0';
    return NextResponse.json(
      { trainNo, fullStops },
      { headers: { 'Cache-Control': cacheHeader } }
    );
  }

  const to = req.nextUrl.searchParams.get('to') || '';

  const result = await getRealThsrData(from, to || undefined);
  const cacheHeader =
    result.trains.length > 0
      ? 'public, s-maxage=15, stale-while-revalidate=30'
      : 'no-store, max-age=0';

  return NextResponse.json(
    {
      stations: THSR_STATIONS,
      trains: result.trains,
      liveVehicles: result.liveVehicles,
      updatedAt: result.updatedAt,
      sourceUpdatedAt: result.sourceUpdatedAt,
      source: result.source,
    },
    { headers: { 'Cache-Control': cacheHeader } }
  );
}
