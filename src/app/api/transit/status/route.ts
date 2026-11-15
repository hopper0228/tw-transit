import { NextResponse } from 'next/server';
import { isTdxConfigured } from '@/lib/tdx-client';

export async function GET() {
  const configured = isTdxConfigured();
  return NextResponse.json({
    source: configured ? 'tdx' : 'opendata',
    configured,
    message: configured
      ? '已連接交通部 TDX 即時資料服務'
      : '雙北公車 / YouBike / 停車場已接通政府即時 OpenData；軌道運具為模擬資料',
  });
}
