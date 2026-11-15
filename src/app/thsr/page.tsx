'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Zap } from 'lucide-react';
import AutoRefreshBadge from '@/components/AutoRefreshBadge';
import { THSR_STATIONS } from '@/lib/mock-data';
import { ThsrTrainRow } from '@/lib/types';

function renderSeatBadge(status: ThsrTrainRow['standardSeatStatus']) {
  if (status === 'available') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        充裕
      </span>
    );
  }
  if (status === 'limited') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        有限
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950/60 dark:text-red-300">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      已滿
    </span>
  );
}

function ThsrPageInner() {
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(searchParams.get('from') || '1000');
  const [to, setTo] = useState('1040');
  const [trains, setTrains] = useState<ThsrTrainRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);

  const loadThsr = useCallback(async () => {
    try {
      const res = await fetch(`/api/transit/thsr?from=${from}&to=${to}`);
      const data = await res.json();
      setTrains(data.trains || []);
      setUpdatedAt(data.updatedAt || '');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadThsr();
    }, 0);
    return () => clearTimeout(t);
  }, [loadThsr]);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    void loadThsr();
  }, [loadThsr]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <Zap className="h-6 w-6 text-orange-600" />
          台灣高鐵即時查詢
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          車次時刻、停靠模式與即時剩餘座位燈號
        </p>
      </div>

      {/* 起訖站快速選擇器 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            {THSR_STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                出發：{s.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            title="起訖站對調"
          >
            <ArrowLeftRight className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          </button>

          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            {THSR_STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                抵達：{s.name}
              </option>
            ))}
          </select>

          <AutoRefreshBadge
            intervalSeconds={15}
            onRefresh={handleManualRefresh}
            isRefreshing={loading}
            lastUpdated={updatedAt}
          />
        </div>
      </div>

      {/* 車次列表 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {trains.map((t) => (
            <li
              key={t.trainNo}
              className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <span className="block rounded-lg bg-orange-600 px-2.5 py-1 text-xs font-bold text-white tabular-nums">
                    {t.trainNo}
                  </span>
                  <span className="mt-1 block text-[11px] font-medium text-slate-500">
                    {t.stopPattern}
                  </span>
                </div>

                <div>
                  <div className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-white">
                    {t.departureTime} → {t.arrivalTime}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t.originStation} → {t.destinationStation} · 車程{' '}
                    {t.durationMinutes} 分鐘 · 自由座 {t.nonReservedCars}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="mb-1 text-[10px] text-slate-400">標準車廂</div>
                  {renderSeatBadge(t.standardSeatStatus)}
                </div>
                <div className="text-center">
                  <div className="mb-1 text-[10px] text-slate-400">商務車廂</div>
                  {renderSeatBadge(t.businessSeatStatus)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ThsrPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">載入高鐵資訊中...</div>
      }
    >
      <ThsrPageInner />
    </Suspense>
  );
}
