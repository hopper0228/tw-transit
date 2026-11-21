import { NextRequest, NextResponse } from 'next/server';
import { TRA_STATIONS } from '@/lib/mock-data';
import { getRealTraData, getTraTrainStops, getTraTrainsStops } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const modeParam = req.nextUrl.searchParams.get('mode');
  const trainNo = req.nextUrl.searchParams.get('trainNo') || '';

  if (modeParam === 'trains') {
    const rawNos = req.nextUrl.searchParams.get('trainNos') || '';
    const trainNos = rawNos
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 60);
    const stopsByTrain = await getTraTrainsStops(trainNos);
    const cacheHeader =
      Object.keys(stopsByTrain).length > 0
        ? 'public, s-maxage=3600, stale-while-revalidate=7200'
        : 'no-store, max-age=0';
    return NextResponse.json(
      { stopsByTrain },
      { headers: { 'Cache-Control': cacheHeader } }
    );
  }

  if (modeParam === 'train' && trainNo) {
    const fullStops = await getTraTrainStops(trainNo);
    const cacheHeader =
      fullStops.length > 0
        ? 'public, s-maxage=3600, stale-while-revalidate=7200'
        : 'no-store, max-age=0';
    return NextResponse.json(
      { trainNo, fullStops },
      { headers: { 'Cache-Control': cacheHeader } }
    );
  }

  const mode = modeParam === 'od' ? 'od' : 'board';
  const station = req.nextUrl.searchParams.get('station') || '1000';
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const to = req.nextUrl.searchParams.get('to') || '3300';

  const result = await getRealTraData(mode, station, from, to);
  const cacheHeader =
    result.trains.length > 0
      ? 'public, s-maxage=15, stale-while-revalidate=30'
      : 'no-store, max-age=0';

  return NextResponse.json(
    {
      stations: TRA_STATIONS,
      trains: result.trains,
      liveVehicles: result.liveVehicles,
      updatedAt: result.updatedAt,
      sourceUpdatedAt: result.sourceUpdatedAt,
      source: result.source,
    },
    { headers: { 'Cache-Control': cacheHeader } }
  );
}
