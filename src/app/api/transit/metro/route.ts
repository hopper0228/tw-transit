import { NextRequest, NextResponse } from 'next/server';
import { getMockMetroStation, METRO_SYSTEMS } from '@/lib/mock-data';

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get('system') || 'TRTC';
  const station = req.nextUrl.searchParams.get('station');

  if (!station) {
    return NextResponse.json({
      systems: METRO_SYSTEMS,
      source: 'mock',
    });
  }

  const detail = getMockMetroStation(system, station);
  return NextResponse.json(detail);
}
