import { NextRequest, NextResponse } from 'next/server';
import { THSR_STATIONS } from '@/lib/mock-data';
import { getRealThsrData } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const to = req.nextUrl.searchParams.get('to') || '1040';

  const result = await getRealThsrData(from, to);

  return NextResponse.json(
    {
      stations: THSR_STATIONS,
      trains: result.trains,
      liveVehicles: result.liveVehicles,
      updatedAt: result.updatedAt,
      sourceUpdatedAt: result.sourceUpdatedAt,
      source: result.source,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
