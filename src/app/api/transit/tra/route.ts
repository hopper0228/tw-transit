import { NextRequest, NextResponse } from 'next/server';
import { TRA_STATIONS } from '@/lib/mock-data';
import { getRealTraData } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') === 'od' ? 'od' : 'board';
  const station = req.nextUrl.searchParams.get('station') || '1000';
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const to = req.nextUrl.searchParams.get('to') || '3300';

  const result = await getRealTraData(mode, station, from, to);

  return NextResponse.json({
    stations: TRA_STATIONS,
    trains: result.trains,
    liveVehicles: result.liveVehicles,
    updatedAt: result.updatedAt,
    source: result.source,
  });
}
