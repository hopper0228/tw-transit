import { NextRequest, NextResponse } from 'next/server';
import { METRO_SYSTEMS } from '@/lib/mock-data';
import { getRealMetroStation, getRealMetroSystemSnapshot } from '@/lib/rail-live';

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get('system') || 'TRTC';
  const mode = req.nextUrl.searchParams.get('mode');
  const station = req.nextUrl.searchParams.get('station');

  if (mode === 'snapshot') {
    const snapshot = await getRealMetroSystemSnapshot(system);
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

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
