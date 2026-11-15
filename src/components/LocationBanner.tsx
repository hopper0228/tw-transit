'use client';

import { LocateFixed } from 'lucide-react';
import { GeoCoords } from '@/lib/location';

interface LocationBannerProps {
  coords: GeoCoords | null;
  status: 'idle' | 'locating' | 'granted' | 'denied';
  onRefresh: () => void;
  label?: string;
}

export default function LocationBanner({
  coords,
  status,
  onRefresh,
  label = '已依裝置目前位置由近到遠排序',
}: LocationBannerProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
        <LocateFixed
          className={`h-3.5 w-3.5 ${
            status === 'locating'
              ? 'animate-spin text-blue-600'
              : coords
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-400'
          }`}
        />
        <span>
          {status === 'locating'
            ? '正在取得裝置目前位置...'
            : coords
            ? label
            : '未取得定位權限，目前顯示預設排序'}
        </span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        {coords ? '重新定位' : '開啟定位'}
      </button>
    </div>
  );
}
