import { NextRequest, NextResponse } from 'next/server';
import { getMockThsrTrains, THSR_STATIONS } from '@/lib/mock-data';

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from') || '1000';
  const to = req.nextUrl.searchParams.get('to') || '1040';

  const trains = getMockThsrTrains(from, to);

  return NextResponse.json({
    stations: THSR_STATIONS,
    trains,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  });
}
