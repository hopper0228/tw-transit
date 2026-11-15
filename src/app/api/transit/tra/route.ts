import { NextRequest, NextResponse } from 'next/server';
import { getMockTraData, TRA_STATIONS } from '@/lib/mock-data';

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') === 'od' ? 'od' : 'board';
  const station = req.nextUrl.searchParams.get('station') || '1000';
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const to = req.nextUrl.searchParams.get('to') || '3300';

  const trains = getMockTraData(mode, station, from, to);

  return NextResponse.json({
    stations: TRA_STATIONS,
    trains,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
