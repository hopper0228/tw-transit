import { NextRequest, NextResponse } from 'next/server';
import { THSR_STATIONS } from '@/lib/mock-data';
import {
  getRealThsrData,
  getRealThsrLive,
  getThsrTrainStops,
  getThsrTrainsStops,
} from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const modeParam = req.nextUrl.searchParams.get('mode');
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const trainNo = req.nextUrl.searchParams.get('trainNo') || '';

  if (modeParam === 'live') {
    const live = await getRealThsrLive(from);
    const cacheHeader =
      Object.keys(live.seatByTrain).length > 0
        ? 'public, s-maxage=10, stale-while-revalidate=10'
        : 'no-store, max-age=0';
    return NextResponse.json(live, {
      headers: { 'Cache-Control': cacheHeader },
    });
  }

  if (modeParam === 'trains') {
    const rawNos = req.nextUrl.searchParams.get('trainNos') || '';
    const trainNos = rawNos
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 60);
    const stopsByTrain = await getThsrTrainsStops(from, trainNos);
    const cacheHeader =
      Object.keys(stopsByTrain).length > 0
        ? 'public, s-maxage=60, stale-while-revalidate=120'
        : 'no-store, max-age=0';
    return NextResponse.json(
      { stopsByTrain },
      { headers: { 'Cache-Control': cacheHeader } }
    );
  }

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
      ? 'public, s-maxage=10, stale-while-revalidate=10'
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
