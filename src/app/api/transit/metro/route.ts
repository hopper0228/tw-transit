import { NextRequest, NextResponse } from 'next/server';
import { METRO_SYSTEMS } from '@/lib/mock-data';
import { getRealMetroStation } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get('system') || 'TRTC';
  const station = req.nextUrl.searchParams.get('station');

  if (!station) {
    return NextResponse.json({
      systems: METRO_SYSTEMS,
      source: 'tdx',
    });
  }

  const detail = await getRealMetroStation(system, station);
  return NextResponse.json(detail);
}
