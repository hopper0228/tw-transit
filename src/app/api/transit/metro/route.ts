import { NextRequest, NextResponse } from 'next/server';
import { METRO_SYSTEMS } from '@/lib/mock-data';
import { getRealMetroStation } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get('system') || 'TRTC';
  const station = req.nextUrl.searchParams.get('station');

  if (!station) {
    return NextResponse.json(
      { systems: METRO_SYSTEMS, source: 'tdx' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const detail = await getRealMetroStation(system, station);
  return NextResponse.json(detail, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
